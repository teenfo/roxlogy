-- ============================================================
-- Roxlogy — 저하율 기준선에 "세션 이후" 창을 연다
--
-- 060 은 기준선을 세션 날짜 기준 과거 90일에서만 찾았다. 원칙적으로는 맞지만
-- (세션 뒤의 러닝으로 그 세션을 설명할 수는 없으니) 실제로는 기능이 죽는다:
-- 러닝 기록은 오늘부터 쌓이는데 시뮬 세션은 전부 그 전에 있으므로, 다음 시뮬을
-- 뛰기 전까지 모든 세션이 "기준선 없음" 이 된다.
--
-- 러닝 체력은 몇 주 만에 크게 변하지 않는다. 그래서 세션 판정에 한해 이후
-- 30일까지 인정한다 — 세션 무렵의 러닝 체력을 대변한다고 보는 것이다.
-- 어떤 기록을 썼는지는 UI 에 그대로 노출되므로(from_ran_on) 숨은 보정이 아니다.
--
-- /runs 의 "현재 1km 기준선" 은 의미가 다르다(오늘까지의 최근 90일). 그래서
-- 창을 넓히는 건 인자로 받고 기본값은 0 이다 — 기존 호출부 동작은 그대로다.
-- ============================================================

-- 반환 타입은 같지만 인자가 바뀌므로 먼저 드롭해야 한다
drop function if exists public.run_1k_baseline(date);

create or replace function public.run_1k_baseline(
  p_as_of date default app_today(),
  -- p_as_of 이후로도 인정할 일수. 0 이면 과거만 본다.
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
    where r.deleted_at is null
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
  -- 세션 날짜는 KST 로 판정한다 — ::date 는 UTC 라 runs.ran_on(app_today, KST)
  -- 과 하루가 어긋나 기준선을 놓친다.
  select (s.started_at at time zone 'Asia/Seoul')::date into v_date
    from sessions s where s.id = p_session and s.deleted_at is null;
  if v_date is null then return null; end if;

  select avg(g.split_time_ms), count(*) into v_lap_ms, v_laps
    from session_segments g
   where g.session_id = p_session and g.kind = 'run' and g.split_time_ms is not null;
  if v_laps = 0 then return null; end if;

  -- 세션 무렵(이전 90일 ~ 이후 30일)의 러닝 체력을 기준선으로 쓴다
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

grant execute on function public.run_1k_baseline(date, integer) to anon, authenticated;
grant execute on function public.session_run_degradation(uuid) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $guard$
declare
  v_uid uuid;
  v_sid uuid;
  v_deg jsonb;
  v_base numeric;
begin
  select id into v_uid from public.profiles order by created_at limit 1;
  if v_uid is null then return; end if;

  -- 40일 전 시뮬 (랩 평균 5:00)
  v_sid := gen_random_uuid();
  insert into public.sessions (id, user_id, source_device, started_at)
  values (v_sid, v_uid, 'web', now() - interval '40 days');
  insert into public.session_segments (session_id, seq, kind, split_time_ms)
  select v_sid, g, 'run', 300000 from generate_series(1, 8) g;

  insert into public.runs (user_id, ran_on, distance_m, duration_ms, kind)
  values (v_uid, app_today() - 20, 1000, 240000, 'interval'),  -- 세션 +20일 → 인정
         (v_uid, app_today() - 2, 1000, 200000, 'interval');   -- 세션 +38일 → 제외

  -- 세션 판정: +30일 창 안의 4:00 만 잡혀야 한다 (더 빠른 3:20 은 창 밖)
  v_deg := public.session_run_degradation(v_sid);
  if (v_deg->'baseline'->>'baseline_1k_ms')::numeric is distinct from 240000 then
    raise exception '가드: 세션 기준선이 240000 이 아닙니다 (%)',
      v_deg->'baseline'->>'baseline_1k_ms';
  end if;
  if (v_deg->>'degradation_pct')::numeric is distinct from 25.0 then
    raise exception '가드: 저하율이 25.0 이 아닙니다 (%)', v_deg->>'degradation_pct';
  end if;

  -- /runs 의 현재 기준선은 창을 넓히지 않는다 — 오늘까지 최고인 3:20 이 잡혀야 한다
  v_base := (public.run_1k_baseline(app_today())->>'baseline_1k_ms')::numeric;
  if v_base is distinct from 200000 then
    raise exception '가드: 현재 기준선이 200000 이 아닙니다 (%)', v_base;
  end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm <> '__guard_rollback__' then raise; end if;
end $guard$;
