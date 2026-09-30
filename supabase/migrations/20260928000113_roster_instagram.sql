-- ============================================================
-- Roxlogy — 크루 멤버 명단에 인스타 핸들
--
-- 멤버 탭 행과 명단 다운로드에 인스타를 같이 보여준다. 핸들은 공개 프로필
-- (public_profile)에도 나가는 값이라 명단이 보이는 사람(로그인 + 공개 크루
-- 또는 크루원)에게는 그대로 내린다 — 이메일처럼 운영진 게이트를 두지 않는다.
--
-- 반환 모양이 바뀌므로 drop·재생성. 컬럼 **추가**라 옛 번들은 무시하고
-- 지나간다(CLAUDE.md "덧붙였다가 나중에 걷어내기"). 본문은 069 와 같고
-- 마지막 컬럼만 더했다.
-- ============================================================

drop function if exists public.crew_roster(text, integer);
create function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(user_id uuid, display_name text, email text, division text,
              role text, joined_at timestamptz, session_count bigint,
              attend_count bigint, attend_paid_count bigint,
              tier_id uuid, tier_name text, tier_color text,
              instagram text)
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
         t.id, t.name, t.color,
         nullif(p.instagram, '')
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

-- 검증 — 040·069 의 가드를 그대로 다시 건다 (재생성하며 빠뜨리지 않았는지)
do $$
declare v_def text; n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_roster'
    and a.nm in ('email', 'instagram');
  if n <> 2 then raise exception '가드: crew_roster 출력 컬럼이 빠졌습니다 (%)', n; end if;

  select pg_get_functiondef(oid) into v_def from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'crew_roster';
  if v_def !~ 'is_crew_staff\(c\.id\)' then
    raise exception '가드: crew_roster 의 이메일에 스태프 게이트가 없습니다';
  end if;
  if v_def !~ 'auth\.uid\(\)\) is not null' then
    raise exception '가드: crew_roster 의 로그인 조건이 빠졌습니다';
  end if;
end $$;

