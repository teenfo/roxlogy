-- 크루 조회 RPC — 공개 크루 페이지는 비로그인도 열람 가능해야 하므로 SECURITY DEFINER 로
-- profiles(본인만 select 가능)의 display_name 을 안전하게 노출한다.
-- 기존 community_feed / leaderboard_overall 과 같은 규약을 따른다.

create or replace function public.crew_overview(p_slug text)
returns table(
  id uuid, slug text, name text, tagline text, description text,
  logo_url text, cover_url text, location text, home_gym text, links jsonb,
  member_count bigint, post_count bigint, upcoming_count bigint,
  my_role text, my_status text
)
language sql stable security definer set search_path to 'public' as $$
  select c.id, c.slug, c.name, c.tagline, c.description,
         c.logo_url, c.cover_url, c.location, c.home_gym, c.links,
         (select count(*) from crew_members m where m.crew_id = c.id and m.status = 'active'),
         (select count(*) from crew_posts p where p.crew_id = c.id and p.deleted_at is null),
         (select count(*) from crew_events e
            where e.crew_id = c.id and e.cancelled_at is null and e.starts_at >= now()),
         (select m.role from crew_members m where m.crew_id = c.id and m.user_id = auth.uid()),
         (select m.status from crew_members m where m.crew_id = c.id and m.user_id = auth.uid())
  from crews c
  where c.slug = p_slug and (c.is_public or is_crew_member(c.id));
$$;

create or replace function public.crew_board(
  p_slug text, p_category text default null, p_limit integer default 20, p_offset integer default 0
)
returns table(
  id uuid, category text, title text, body text, image_urls text[],
  author_id uuid, author_name text, author_division text,
  pinned boolean, comment_count integer, like_count integer,
  liked_by_me boolean, created_at timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.category, p.title, p.body, p.image_urls,
         p.author_id,
         coalesce(pr.display_name, 'Athlete') as author_name,
         pr.division as author_division,
         p.pinned, p.comment_count, p.like_count,
         exists (select 1 from crew_post_likes l
                 where l.post_id = p.id and l.user_id = auth.uid()) as liked_by_me,
         p.created_at
  from crew_posts p
  join crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.author_id
  where c.slug = p_slug
    and p.deleted_at is null
    and (c.is_public or is_crew_member(c.id))
    and (p_category is null or p.category = p_category)
  order by p.pinned desc, p.created_at desc
  limit least(p_limit, 50) offset greatest(p_offset, 0);
$$;

create or replace function public.crew_post_detail(p_post uuid)
returns table(
  id uuid, category text, title text, body text, image_urls text[],
  author_id uuid, author_name text, pinned boolean,
  comment_count integer, like_count integer, liked_by_me boolean,
  created_at timestamptz, comments jsonb
)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.category, p.title, p.body, p.image_urls,
         p.author_id, coalesce(pr.display_name, 'Athlete'), p.pinned,
         p.comment_count, p.like_count,
         exists (select 1 from crew_post_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', cm.id, 'author_id', cm.author_id,
             'author_name', coalesce(cpr.display_name, 'Athlete'),
             'body', cm.body, 'created_at', cm.created_at
           ) order by cm.created_at)
           from crew_post_comments cm
           join profiles cpr on cpr.id = cm.author_id
           where cm.post_id = p.id and cm.deleted_at is null
         ), '[]'::jsonb)
  from crew_posts p
  join crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.author_id
  where p.id = p_post and p.deleted_at is null
    and (c.is_public or is_crew_member(c.id));
$$;

-- 크루 리더보드: 전역 leaderboard_overall 과 같은 "스테이션이 포함된 세션의 최고 총시간"
-- 기준을 쓰되 크루 활성 멤버로 모집단을 좁힌다. 공개 동의(leaderboard_opt_in)는 그대로 존중.
create or replace function public.crew_leaderboard(
  p_slug text, p_division text default null, p_limit integer default 50
)
returns table(
  rank bigint, user_id uuid, display_name text, division text,
  best_ms bigint, session_count bigint, last_at timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  with members as (
    select m.user_id from crew_members m
    join crews c on c.id = m.crew_id
    where c.slug = p_slug and m.status = 'active'
  ), sim as (
    select s.user_id, s.division,
           min(s.total_time_ms) as best_ms,
           count(*) as session_count,
           max(s.started_at) as last_at
    from sessions s
    join members mb on mb.user_id = s.user_id
    where s.deleted_at is null
      and s.total_time_ms is not null
      and coalesce(s.leaderboard_excluded, false) = false
      and exists (select 1 from session_segments g
                  where g.session_id = s.id and g.kind = 'station')
    group by s.user_id, s.division
  )
  select row_number() over (order by sim.best_ms asc),
         sim.user_id, coalesce(p.display_name, 'Athlete'), sim.division,
         sim.best_ms, sim.session_count, sim.last_at
  from sim join profiles p on p.id = sim.user_id
  where p.leaderboard_opt_in = true
    and (p_division is null or sim.division = p_division)
  order by sim.best_ms asc
  limit least(p_limit, 100);
$$;

create or replace function public.crew_schedule(
  p_slug text, p_from timestamptz default now(), p_limit integer default 20
)
returns table(
  id uuid, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  coach_name text, going_count bigint, my_status text
)
language sql stable security definer set search_path to 'public' as $$
  select e.id, e.title, e.description, e.kind,
         e.starts_at, e.ends_at, e.location, e.capacity,
         co.display_name as coach_name,
         (select count(*) from crew_event_rsvps r
            where r.event_id = e.id and r.status = 'going') as going_count,
         (select r.status from crew_event_rsvps r
            where r.event_id = e.id and r.user_id = auth.uid()) as my_status
  from crew_events e
  join crews c on c.id = e.crew_id
  left join profiles co on co.id = e.coach_id
  where c.slug = p_slug
    and e.cancelled_at is null
    and e.starts_at >= p_from
    and (c.is_public or is_crew_member(c.id))
  order by e.starts_at asc
  limit least(p_limit, 100);
$$;

create or replace function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(
  user_id uuid, display_name text, division text, role text,
  joined_at timestamptz, session_count bigint
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), p.division, m.role, m.joined_at,
         (select count(*) from sessions s
            where s.user_id = m.user_id and s.deleted_at is null)
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  where c.slug = p_slug and m.status = 'active'
    and (c.is_public or is_crew_member(c.id))
  order by case m.role when 'owner' then 0 when 'coach' then 1 else 2 end, m.joined_at
  limit least(p_limit, 500);
$$;

-- join_policy 가 open 이면 즉시 active, 그 외에는 pending 으로 넣는다.
create or replace function public.join_crew(p_slug text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_policy text; v_status text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select id, join_policy into v_crew, v_policy from crews where slug = p_slug;
  if v_crew is null then raise exception '크루를 찾을 수 없습니다'; end if;
  v_status := case when v_policy = 'open' then 'active' else 'pending' end;
  insert into crew_members(crew_id, user_id, role, status)
  values (v_crew, auth.uid(), 'member', v_status)
  on conflict (crew_id, user_id) do nothing;
  return v_status;
end;
$$;

grant execute on function public.crew_overview(text) to anon, authenticated;
grant execute on function public.crew_board(text, text, integer, integer) to anon, authenticated;
grant execute on function public.crew_post_detail(uuid) to anon, authenticated;
grant execute on function public.crew_leaderboard(text, text, integer) to anon, authenticated;
grant execute on function public.crew_schedule(text, timestamptz, integer) to anon, authenticated;
grant execute on function public.crew_roster(text, integer) to anon, authenticated;
grant execute on function public.join_crew(text) to authenticated;
