-- ============================================================
-- 007 — 서비스 내 리더보드 (S8)
-- 프라이버시: 기본 비공개(opt-in=false). 리더보드는 옵트인한 사용자의
-- 집계 최고 기록(표시 이름·디비전·기록)만 노출한다. user_id/이메일 등
-- 식별정보는 반환하지 않는다. RLS를 우회해 타 사용자 집계를 만들되,
-- security definer 함수 안에서 opt-in 필터를 강제해 노출 범위를 제한한다.
-- ============================================================

alter table public.profiles
  add column leaderboard_opt_in boolean not null default false;

-- 종합 리더보드: 레이스 시뮬(스테이션 포함) 세션의 개인 최고 총기록
create or replace function public.leaderboard_overall(p_division text default null)
returns table(rank bigint, display_name text, division text, best_ms bigint)
language sql
security definer
set search_path = public
stable
as $$
  with sim as (
    select s.user_id, min(s.total_time_ms) as best_ms
    from sessions s
    where s.deleted_at is null
      and s.total_time_ms is not null
      and exists (
        select 1 from session_segments g
        where g.session_id = s.id and g.kind = 'station'
      )
    group by s.user_id
  )
  select row_number() over (order by sim.best_ms asc) as rank,
         coalesce(p.display_name, 'Athlete') as display_name,
         p.division,
         sim.best_ms
  from sim
  join profiles p on p.id = sim.user_id
  where p.leaderboard_opt_in = true
    and (p_division is null or p.division = p_division)
  order by sim.best_ms asc
  limit 100;
$$;

-- 스테이션 리더보드: 특정 운동(스테이션)의 개인 최고 스플릿
create or replace function public.leaderboard_station(
  p_exercise uuid,
  p_division text default null
)
returns table(rank bigint, display_name text, division text, best_ms bigint)
language sql
security definer
set search_path = public
stable
as $$
  with best as (
    select s.user_id, min(g.split_time_ms) as best_ms
    from session_segments g
    join sessions s on s.id = g.session_id
    where s.deleted_at is null
      and g.kind = 'station'
      and g.exercise_id = p_exercise
      and g.split_time_ms is not null
    group by s.user_id
  )
  select row_number() over (order by best.best_ms asc) as rank,
         coalesce(p.display_name, 'Athlete') as display_name,
         p.division,
         best.best_ms
  from best
  join profiles p on p.id = best.user_id
  where p.leaderboard_opt_in = true
    and (p_division is null or p.division = p_division)
  order by best.best_ms asc
  limit 100;
$$;

revoke all on function public.leaderboard_overall(text) from public;
revoke all on function public.leaderboard_station(uuid, text) from public;
grant execute on function public.leaderboard_overall(text) to authenticated;
grant execute on function public.leaderboard_station(uuid, text) to authenticated;
