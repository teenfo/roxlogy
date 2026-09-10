-- 크루 멤버·리더보드는 로그인 후에만 보이게 한다.
--
-- 크루 목록·소개·게시판은 공유 링크로 들어온 사람에게 열어두되, **사람 목록과
-- 기록 순위는 다르다** — 실명·디비전·기록이 익명 방문자에게 그대로 노출된다.
-- 웹에서 안내 카드로 막는 것만으로는 부족하다: anon 키로 RPC 를 직접 부르면
-- 그대로 내려오므로 함수 자체에서 막는다.
--
-- crew_leaderboard 는 그동안 공개 여부 자체를 보지 않았다 — 비공개 크루의
-- 순위도 slug 만 알면 나왔다. 로그인 조건과 함께 공개·회원 조건도 붙인다.

create or replace function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(user_id uuid, display_name text, email text, division text,
              role text, joined_at timestamptz, session_count bigint,
              attend_count bigint, attend_paid_count bigint,
              tier_id uuid, tier_name text, tier_color text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id,
         coalesce(p.display_name, 'Athlete'),
         case when (select is_crew_staff(c.id)) or (select is_admin())
              then u.email::text else null end,
         p.division, m.role, m.joined_at,
         (select count(*) from sessions s
            where s.user_id = m.user_id and s.deleted_at is null),
         case when (select is_crew_member(c.id)) or (select is_admin()) then
           (select count(*) from crew_event_rsvps r
              join crew_events e on e.id = r.event_id
             where r.user_id = m.user_id and e.crew_id = c.id
               and e.cancelled_at is null and r.checked_in_at is not null)
         else null::bigint end,
         case when (select is_crew_member(c.id)) or (select is_admin()) then
           (select count(*) from crew_event_rsvps r
              join crew_events e on e.id = r.event_id
             where r.user_id = m.user_id and e.crew_id = c.id
               and e.cancelled_at is null and not e.fee_exempt
               and r.checked_in_at is not null)
         else null::bigint end,
         t.id, t.name, t.color
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_member_tiers t on t.id = m.tier_id
  where c.slug = p_slug and m.status = 'active'
    and (select auth.uid()) is not null
    and (c.is_public or (select is_crew_member(c.id)))
  order by array_position(array['owner','coach'], m.role),
           coalesce(t.sort_order, 99), coalesce(t.name, ''), m.joined_at
  limit least(p_limit, 500);
$$;

grant execute on function public.crew_roster(text, integer) to anon, authenticated;

create or replace function public.crew_leaderboard(p_slug text, p_division text default null, p_limit integer default 50)
returns table(rank bigint, user_id uuid, display_name text, division text,
              best_ms bigint, session_count bigint, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with members as (
    select m.user_id from crew_members m
    join crews c on c.id = m.crew_id
    where c.slug = p_slug and m.status = 'active'
      and (select auth.uid()) is not null
      and (c.is_public or (select is_crew_member(c.id)))
  ), sim as (
    select s.user_id, s.division,
           min(s.total_time_ms) as best_ms,
           count(*) as session_count,
           max(s.started_at) as last_at
    from sessions s
    join members mb on mb.user_id = s.user_id
    where s.deleted_at is null
      and s.total_time_ms is not null
      and s.total_time_ms >= 1800000
      and coalesce(s.leaderboard_excluded, false) = false
      and (
        select count(*) filter (where g.kind = 'station') >= 8
           and count(*) filter (where g.kind = 'run') >= 8
        from session_segments g where g.session_id = s.id
      )
    group by s.user_id, s.division
  )
  select row_number() over (order by sim.best_ms asc),
         sim.user_id, coalesce(p.display_name, 'Athlete'), sim.division,
         sim.best_ms, sim.session_count, sim.last_at
  from sim join profiles p on p.id = sim.user_id
  where (p_division is null or sim.division = p_division)
  order by sim.best_ms asc
  limit least(p_limit, 100);
$$;

grant execute on function public.crew_leaderboard(text, text, integer) to anon, authenticated;

-- 검증 — 비로그인은 0건, 로그인 사용자는 그대로 보인다.
do $$
declare
  v_slug text;
  v_user uuid;
  v_anon_roster int;
  v_anon_lb int;
  v_auth_roster int;
begin
  select c.slug into v_slug
    from crews c join crew_members m on m.crew_id = c.id and m.status = 'active'
   where c.is_public and c.status = 'active'
   group by c.slug order by count(*) desc limit 1;
  if v_slug is null then
    raise notice 'no public crew — skipping guard';
    return;
  end if;
  select m.user_id into v_user
    from crews c join crew_members m on m.crew_id = c.id and m.status = 'active'
   where c.slug = v_slug limit 1;

  -- 익명
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_anon_roster from crew_roster(v_slug, 500);
  select count(*) into v_anon_lb from crew_leaderboard(v_slug, null, 100);
  if v_anon_roster <> 0 then
    raise exception 'anon still sees % roster rows', v_anon_roster;
  end if;
  if v_anon_lb <> 0 then
    raise exception 'anon still sees % leaderboard rows', v_anon_lb;
  end if;

  -- 로그인 사용자
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  select count(*) into v_auth_roster from crew_roster(v_slug, 500);
  if v_auth_roster = 0 then
    raise exception 'logged-in user sees no roster rows';
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;
