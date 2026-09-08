-- ============================================================
-- Roxlogy — 러닝 기준선 소유권 명시 + 내 평소 저하율
--
-- 버그: run_1k_baseline 이 RLS 에만 기대고 있었다. runs_select 정책은
--   user_id = auth.uid() or is_admin()
-- 이라서 관리자 계정에서는 전체 사용자 중 가장 빠른 러닝이 "내 기준선" 으로
-- 잡힌다. 명시적 user_id 필터를 넣는다
-- (CLAUDE.md: 내 데이터 조회에 user_id 필터를 빼먹지 말 것).
--
-- session_run_degradation 도 같은 이유로 세션을 본인 것으로 한정한다 —
-- sessions 는 shared 행이 피드용으로 전체 공개라, 필터가 없으면 남의 공개
-- 세션 랩을 내 러닝 기준선과 섞어 무의미한 값을 낸다.
--
-- 그리고 목표 역산에 쓸 my_run_degradation 을 추가한다: 목표 랩 페이스를
-- "필요한 순수 1km" 로 되돌리려면 내 평소 저하율이 있어야 한다.
-- ============================================================

drop function if exists public.run_1k_baseline(date, integer);

create or replace function public.run_1k_baseline(
  p_as_of date default app_today(),
  p_after_days integer default 0
)
returns jsonb
language sql stable set search_path to 'public' as $fn$
  select case when b.id is null then null else jsonb_build_object(
    'baseline_1k_ms', round(b.projected_ms),
    'from_run_id', b.id,
    'from_distance_m', b.distance_m,
    'from_duration_ms', b.duration_ms,
    'from_ran_on', b.ran_on,
    'sample_runs', b.n
  ) end
  from (
    select r.id, r.distance_m, r.duration_ms, r.ran_on,
           r.duration_ms * power(1000.0 / r.distance_m, 1.06) as projected_ms,
           count(*) over () as n
    from runs r
    where r.user_id = (select auth.uid())
      and r.deleted_at is null
      and r.ran_on <= p_as_of + greatest(coalesce(p_after_days, 0), 0)
      and r.ran_on > p_as_of - 90
      and r.distance_m between 800 and 30000
    order by r.duration_ms * power(1000.0 / r.distance_m, 1.06)
    limit 1
  ) b;
$fn$;

create or replace function public.session_run_degradation(p_session uuid)
returns jsonb
language plpgsql stable set search_path to 'public' as $fn$
declare
  v_date date;
  v_lap_ms numeric;
  v_laps integer;
  v_base jsonb;
  v_base_ms numeric;
  v_pct numeric;
begin
  select (s.started_at at time zone 'Asia/Seoul')::date into v_date
    from sessions s
   where s.id = p_session and s.deleted_at is null
     and s.user_id = (select auth.uid());
  if v_date is null then return null; end if;

  select avg(g.split_time_ms), count(*) into v_lap_ms, v_laps
    from session_segments g
   where g.session_id = p_session and g.kind = 'run' and g.split_time_ms is not null;
  if v_laps = 0 then return null; end if;

  v_base := public.run_1k_baseline(v_date, 30);
  v_base_ms := (v_base->>'baseline_1k_ms')::numeric;

  if v_base_ms is not null and v_base_ms > 0 then
    v_pct := round((v_lap_ms - v_base_ms) / v_base_ms * 100, 1);
  end if;

  return jsonb_build_object(
    'session_id', p_session,
    'sim_lap_avg_ms', round(v_lap_ms),
    'laps', v_laps,
    'baseline', v_base,
    'degradation_pct', v_pct,
    'grade', case
      when v_pct is null then null
      when v_pct < 10 then 'excellent'
      when v_pct < 20 then 'good'
      when v_pct < 30 then 'fair'
      else 'weak' end);
end;
$fn$;

-- 내 평소 저하율 — 목표 랩을 "필요한 순수 1km" 로 되돌릴 때 쓴다.
-- 한 세션은 컨디션에 흔들리므로 중앙값을 쓰고, 폭(최저~최고)도 같이 준다.
create or replace function public.my_run_degradation(p_days integer default 180)
returns jsonb
language sql stable set search_path to 'public' as $fn$
  with mine as (
    select s.id,
           (s.started_at at time zone 'Asia/Seoul')::date as d,
           avg(g.split_time_ms) as lap_ms
    from sessions s
    join session_segments g
      on g.session_id = s.id and g.kind = 'run' and g.split_time_ms is not null
    where s.user_id = (select auth.uid())
      and s.deleted_at is null
      and s.started_at >= now() - make_interval(days => greatest(coalesce(p_days, 180), 1))
    group by s.id, s.started_at
    having count(*) >= 2
  ),
  scored as (
    select m.lap_ms,
           (public.run_1k_baseline(m.d, 30)->>'baseline_1k_ms')::numeric as base_ms
    from mine m
  ),
  pct as (
    select (lap_ms - base_ms) / base_ms * 100 as p
    from scored where base_ms is not null and base_ms > 0
  )
  select case when count(*) = 0 then null else jsonb_build_object(
    'degradation_pct', round((percentile_cont(0.5) within group (order by p))::numeric, 1),
    'best_pct', round(min(p), 1),
    'worst_pct', round(max(p), 1),
    'sessions', count(*)
  ) end
  from pct;
$fn$;

grant execute on function public.run_1k_baseline(date, integer) to anon, authenticated;
grant execute on function public.session_run_degradation(uuid) to anon, authenticated;
grant execute on function public.my_run_degradation(integer) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
-- 기존 실데이터가 몇 건이든 무관하게 판정하려고 "증가분" 으로 본다.
do $guard$
declare
  v_a uuid; v_b uuid; v_sa uuid; v_sb uuid;
  v_base numeric; v_deg jsonb; v_before int; v_after int; v_worst numeric;
begin
  select id into v_a from public.profiles order by created_at limit 1;
  select id into v_b from public.profiles where id <> v_a order by created_at limit 1;
  if v_a is null or v_b is null then return; end if;

  -- 이 블록에서는 A 로 행동한다 (auth.uid() 는 이 설정을 읽는다)
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_a)::text, true);

  -- A: 1km 4:00 / B: 1km 2:00 (훨씬 빠름 — 새어 들어오면 기준선이 뒤바뀐다)
  insert into public.runs (user_id, ran_on, distance_m, duration_ms, kind)
  values (v_a, app_today() - 5, 1000, 240000, 'interval'),
         (v_b, app_today() - 5, 1000, 120000, 'interval');

  v_base := (public.run_1k_baseline()->>'baseline_1k_ms')::numeric;
  if v_base is distinct from 240000 then
    raise exception '가드: 남의 러닝이 기준선에 섞였습니다 (%)', v_base;
  end if;

  v_before := coalesce((public.my_run_degradation()->>'sessions')::int, 0);

  -- A 의 시뮬(랩 5:00 → 25%) / B 의 공개 시뮬(랩 10:00 → 150%, 새면 최댓값이 튄다)
  v_sa := gen_random_uuid(); v_sb := gen_random_uuid();
  insert into public.sessions (id, user_id, source_device, started_at, shared)
  values (v_sa, v_a, 'web', now(), false),
         (v_sb, v_b, 'web', now(), true);
  insert into public.session_segments (session_id, seq, kind, split_time_ms)
  select v_sa, g, 'run', 300000 from generate_series(1, 8) g;
  insert into public.session_segments (session_id, seq, kind, split_time_ms)
  select v_sb, g, 'run', 600000 from generate_series(1, 8) g;

  v_deg := public.my_run_degradation();
  v_after := (v_deg->>'sessions')::int;
  v_worst := (v_deg->>'worst_pct')::numeric;

  if v_after <> v_before + 1 then
    raise exception '가드: 세션 수가 % → % 로 늘었습니다 (B 의 공개 세션 유입 의심)',
      v_before, v_after;
  end if;
  if v_worst >= 100 then
    raise exception '가드: 남의 공개 세션이 저하율 최댓값에 섞였습니다 (%)', v_worst;
  end if;

  if public.session_run_degradation(v_sb) is not null then
    raise exception '가드: 남의 세션 저하율이 반환됐습니다';
  end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm <> '__guard_rollback__' then raise; end if;
end $guard$;
