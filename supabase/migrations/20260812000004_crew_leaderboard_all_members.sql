-- ============================================================
-- Roxlogy — 크루 리더보드는 멤버 전원 표시
--
-- 크루 가입 자체를 크루 리더보드 참여 동의로 본다(2026-08-12 확정).
-- 프로필의 leaderboard_opt_in 은 전체(공개) 리더보드에만 적용하고,
-- 크루 리더보드는 활성 멤버 전원의 기록을 집계한다.
-- 집계 요건(풀 시뮬 8+8 구간, 총 30분 이상)은 그대로.
-- ============================================================

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
  where (p_division is null or sim.division = p_division)
  order by sim.best_ms asc
  limit least(p_limit, 100);
$$;
