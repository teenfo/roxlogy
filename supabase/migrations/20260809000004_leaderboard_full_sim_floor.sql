-- 리더보드 집계 기준 정정 — 탭 테스트 세션이 1위로 올라오던 문제.
--
-- 기존 조건은 "스테이션 세그먼트가 1개 이상 존재"뿐이어서, 워치에서 흐름을 확인하려고
-- 빠르게 눌러 넘긴 2.4초·53초짜리 세션이 최고 기록으로 잡혔다. 하이록스 풀 시뮬레이션은
-- 정의상 런 8 + 스테이션 8 구간이고 공식 세계기록도 54분대다. 따라서
--   (1) 스테이션 8구간·런 8구간을 모두 갖추고
--   (2) 총시간이 30분 이상
-- 인 세션만 집계한다. 30분은 실제 기록을 하나도 배제하지 않으면서(현 데이터 최속 73분)
-- 테스트 세션을 걸러내는 보수적인 하한이다.

create or replace function public.leaderboard_overall(p_division text default null)
returns table(rank bigint, display_name text, division text, best_ms bigint)
language sql stable security definer set search_path to 'public' as $$
  with sim as (
    select s.user_id, s.division, min(s.total_time_ms) as best_ms
    from sessions s
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
  select row_number() over (order by sim.best_ms asc) as rank,
         coalesce(p.display_name, 'Athlete') as display_name,
         sim.division,
         sim.best_ms
  from sim
  join profiles p on p.id = sim.user_id
  where p.leaderboard_opt_in = true
    and (p_division is null or sim.division = p_division)
  order by sim.best_ms asc
  limit 100;
$$;

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
  where p.leaderboard_opt_in = true
    and (p_division is null or sim.division = p_division)
  order by sim.best_ms asc
  limit least(p_limit, 100);
$$;
