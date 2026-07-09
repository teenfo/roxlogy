-- 리더보드를 세션 디비전 기준으로 집계 + 세션별 노출 제외 토글
-- 기존: 프로필 디비전으로 랭크. 변경: 디비전이 세션 단위로 옮겨졌으므로
--   (user_id, session.division)별로 최고 기록을 뽑아 디비전별로 순위를 낸다.
-- 프로필 leaderboard_opt_in(전역 옵트인)은 그대로 게이트로 유지하고,
-- 추가로 각 세션의 leaderboard_excluded=true인 세션은 집계에서 제외한다.

-- 세션별 리더보드 노출 제외 토글
alter table sessions
  add column if not exists leaderboard_excluded boolean not null default false;

-- 종합(레이스 시뮬) 리더보드: 세션 디비전별 최고 기록
create or replace function public.leaderboard_overall(p_division text default null)
returns table (rank bigint, display_name text, division text, best_ms bigint)
language sql
stable
security definer
set search_path = public
as $$
  with sim as (
    select s.user_id, s.division, min(s.total_time_ms) as best_ms
    from sessions s
    where s.deleted_at is null
      and s.total_time_ms is not null
      and coalesce(s.leaderboard_excluded, false) = false
      and exists (
        select 1 from session_segments g
        where g.session_id = s.id and g.kind = 'station'
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

-- 스테이션별 리더보드: 세션 디비전별 스테이션 최고 스플릿
create or replace function public.leaderboard_station(p_exercise uuid, p_division text default null)
returns table (rank bigint, display_name text, division text, best_ms bigint)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select s.user_id, s.division, min(g.split_time_ms) as best_ms
    from session_segments g
    join sessions s on s.id = g.session_id
    where s.deleted_at is null
      and coalesce(s.leaderboard_excluded, false) = false
      and g.kind = 'station'
      and g.exercise_id = p_exercise
      and g.split_time_ms is not null
    group by s.user_id, s.division
  )
  select row_number() over (order by best.best_ms asc) as rank,
         coalesce(p.display_name, 'Athlete') as display_name,
         best.division,
         best.best_ms
  from best
  join profiles p on p.id = best.user_id
  where p.leaderboard_opt_in = true
    and (p_division is null or best.division = p_division)
  order by best.best_ms asc
  limit 100;
$$;
