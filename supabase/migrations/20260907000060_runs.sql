-- ============================================================
-- Roxlogy — 러닝 기록 (runs / run_splits)
--
-- 왜 sessions 에 넣지 않는가:
--   sessions 는 하이록스 시뮬 전용 구조다. 세그먼트는 run|station|roxzone 이고
--   거리 컬럼이 아예 없다 — 시뮬의 런은 항상 1km 라 거리가 암묵값이기 때문이다.
--   session_metrics 는 정확히 8랩을 전제로 편차를 계산하고, 리더보드는 디비전별
--   완주 시뮬만 줄 세운다. 여기에 "5km 조깅"을 런 세그먼트 1개짜리 세션으로 넣으면
--   지표·리더보드·피드가 전부 예외 처리를 떠안는다. 그래서 별도 테이블로 둔다.
--
-- 왜 그래도 만드는가 (분석):
--   하이록스는 시간의 절반이 러닝이다. 시뮬은 "지친 상태의 페이스"를 알려주지만
--   비교할 기준선인 "순수 러닝 페이스"가 지금 데이터에 없다. 러닝 기록이 그 축을
--   채우면 저하율(=시뮬 랩이 순수 페이스보다 몇 % 느린가)이 계산된다.
--   이게 하이록스 기록을 가장 잘 설명하는 수치다.
-- ============================================================

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ran_on date not null default app_today(),
  started_at timestamptz,
  -- 러닝 성격. 저하율 기준선은 min() 으로 뽑으므로 종류로 거르지 않는다.
  kind text not null default 'easy'
    check (kind in ('easy', 'tempo', 'interval', 'long', 'race', 'other')),
  surface text not null default 'treadmill'
    check (surface in ('treadmill', 'road', 'track', 'trail')),
  -- 100m 미만/200km 초과는 오타로 본다
  distance_m integer not null check (distance_m between 100 and 200000),
  -- 30초 미만/24시간 초과도 오타
  duration_ms bigint not null check (duration_ms between 30000 and 86400000),
  -- 페이스는 DB 가 권위 — 클라이언트는 미리보기만 계산한다.
  -- duration_s / km = (duration_ms/1000) / (distance_m/1000) = duration_ms / distance_m
  pace_s_per_km numeric generated always as (
    duration_ms::numeric / distance_m
  ) stored,
  -- 트레드밀 경사 (하이록스 훈련은 1% 가 흔하다)
  incline_pct numeric(3, 1) check (incline_pct is null or incline_pct between 0 and 30),
  avg_hr smallint check (avg_hr is null or avg_hr between 30 and 240),
  max_hr smallint check (max_hr is null or max_hr between 30 and 240),
  rpe smallint check (rpe is null or rpe between 1 and 10),
  location text check (location is null or char_length(location) <= 80),
  note text check (note is null or char_length(note) <= 500),
  source_device text not null default 'web'
    check (source_device in ('watch', 'phone', 'web')),
  -- 워치 동기화 대비 (LWW 판정은 서버 updated_at 이 아니라 이 값으로 한다)
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 랩/구간 스플릿 (선택) — 인터벌·1km 랩
create table if not exists public.run_splits (
  run_id uuid not null references public.runs(id) on delete cascade,
  seq integer not null check (seq > 0),
  distance_m integer not null check (distance_m between 10 and 200000),
  duration_ms bigint not null check (duration_ms between 1000 and 86400000),
  avg_hr smallint check (avg_hr is null or avg_hr between 30 and 240),
  primary key (run_id, seq)
);

create index if not exists runs_user_idx
  on public.runs(user_id, ran_on desc) where deleted_at is null;
-- 저하율 기준선 조회용 (최근 90일 × 거리 하한)
create index if not exists runs_baseline_idx
  on public.runs(user_id, ran_on desc, distance_m) where deleted_at is null;

create trigger runs_set_updated_at before update on public.runs
  for each row execute function public.set_updated_at();

alter table public.runs enable row level security;
alter table public.run_splits enable row level security;

-- 명령별로 정책 하나씩 (CLAUDE.md 규칙). v1 은 본인만 — 공개·피드는 붙이지 않는다.
drop policy if exists runs_select on public.runs;
create policy runs_select on public.runs
  for select using (user_id = (select auth.uid()) or (select is_admin()));
drop policy if exists runs_insert on public.runs;
create policy runs_insert on public.runs
  for insert with check (user_id = (select auth.uid()));
drop policy if exists runs_update on public.runs;
create policy runs_update on public.runs
  for update using (user_id = (select auth.uid()) or (select is_admin()))
  with check (user_id = (select auth.uid()) or (select is_admin()));
drop policy if exists runs_delete on public.runs;
create policy runs_delete on public.runs
  for delete using (user_id = (select auth.uid()) or (select is_admin()));

-- 스플릿은 run 을 경유한 조인 정책으로 소유권을 판정한다
drop policy if exists run_splits_select on public.run_splits;
create policy run_splits_select on public.run_splits
  for select using (exists (
    select 1 from public.runs r where r.id = run_id
      and (r.user_id = (select auth.uid()) or (select is_admin()))));
drop policy if exists run_splits_insert on public.run_splits;
create policy run_splits_insert on public.run_splits
  for insert with check (exists (
    select 1 from public.runs r where r.id = run_id and r.user_id = (select auth.uid())));
drop policy if exists run_splits_update on public.run_splits;
create policy run_splits_update on public.run_splits
  for update using (exists (
    select 1 from public.runs r where r.id = run_id
      and (r.user_id = (select auth.uid()) or (select is_admin()))))
  with check (exists (
    select 1 from public.runs r where r.id = run_id
      and (r.user_id = (select auth.uid()) or (select is_admin()))));
drop policy if exists run_splits_delete on public.run_splits;
create policy run_splits_delete on public.run_splits
  for delete using (exists (
    select 1 from public.runs r where r.id = run_id
      and (r.user_id = (select auth.uid()) or (select is_admin()))));

-- ============================================================
-- 저하율 분석
--
-- 기준선은 "최근 90일 중 가장 좋은 노력"을 1km 로 환산해 쓴다.
-- 거리가 다른 기록을 그냥 비교하면 안 되므로 리겔(Riegel) 공식으로 환산한다:
--   T2 = T1 × (D2/D1)^1.06
-- 800m 미만은 환산이 과대 추정이라 제외하고, 30km 초과도 제외한다.
-- min() 을 쓰므로 조깅이 섞여 있어도 최고 노력이 기준선이 된다.
--
-- security invoker 로 둔다 — RLS 가 그대로 걸려서 남의 러닝은 애초에 안 보인다.
-- ============================================================
create or replace function public.run_1k_baseline(
  p_as_of date default app_today()
)
returns jsonb
language sql stable set search_path to 'public' as $$
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
      and r.ran_on <= p_as_of
      and r.ran_on > p_as_of - 90
      and r.distance_m between 800 and 30000
    order by r.duration_ms * power(1000.0 / r.distance_m, 1.06)
    limit 1
  ) b;
$$;

-- 시뮬 세션의 런 랩이 순수 러닝 기준선보다 몇 % 느린가.
-- 시뮬 런은 1km 고정이라 랩 평균이 곧 1km 기록이다 — 바로 비교된다.
create or replace function public.session_run_degradation(p_session uuid)
returns jsonb
language plpgsql stable set search_path to 'public' as $$
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

  v_base := public.run_1k_baseline(v_date);
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
    -- 해석 구간. 기준선이 없으면 null 이고 UI 는 안내 문구를 띄운다.
    'grade', case
      when v_pct is null then null
      when v_pct < 10 then 'excellent'
      when v_pct < 20 then 'good'
      when v_pct < 30 then 'fair'
      else 'weak' end);
end;
$$;

grant execute on function public.run_1k_baseline(date) to anon, authenticated;
grant execute on function public.session_run_degradation(uuid) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare
  v_uid uuid;
  v_pace numeric;
  v_base numeric;
  v_expect numeric;
  v_sid uuid;
  v_deg jsonb;
begin
  select id into v_uid from public.profiles order by created_at limit 1;
  if v_uid is null then return; end if;

  insert into public.runs (user_id, ran_on, distance_m, duration_ms, kind)
  values (v_uid, app_today(), 5000, 1500000, 'tempo'),      -- 25:00 → 5:00/km
         (v_uid, app_today(), 1000, 240000, 'interval'),    -- 4:00  → 4:00/km (최고)
         (v_uid, app_today(), 10000, 3600000, 'long'),      -- 60:00 → 6:00/km
         (v_uid, app_today() - 200, 1000, 180000, 'race');  -- 90일 밖 — 무시돼야 함

  -- 생성 컬럼: 5000m / 1,500,000ms = 300 s/km
  select pace_s_per_km into v_pace from public.runs
   where user_id = v_uid and distance_m = 5000 and duration_ms = 1500000;
  if round(v_pace) <> 300 then
    raise exception '가드: 페이스 생성 컬럼이 틀렸습니다 (%)', v_pace;
  end if;

  -- 기준선: 1km 4:00 이 최고 노력이므로 240,000ms. 90일 밖 3:00 은 잡히면 안 된다.
  v_base := (public.run_1k_baseline(app_today())->>'baseline_1k_ms')::numeric;
  if v_base is distinct from 240000 then
    raise exception '가드: 기준선이 240000 이 아닙니다 (%)', v_base;
  end if;

  -- 리겔 환산이 실제로 걸리는지: 5km 25:00 → 1km 약 272초(4:32)
  v_expect := 1500000 * power(1000.0 / 5000, 1.06);
  if v_expect < 265000 or v_expect > 280000 then
    raise exception '가드: 리겔 환산이 예상 범위를 벗어났습니다 (%)', v_expect;
  end if;

  -- 저하율: 랩 평균 5:00 vs 기준선 4:00 → 25.0% 느림
  v_sid := gen_random_uuid();
  insert into public.sessions (id, user_id, source_device, started_at)
  values (v_sid, v_uid, 'web', now());
  insert into public.session_segments (session_id, seq, kind, split_time_ms)
  select v_sid, g, 'run', 300000 from generate_series(1, 8) g;

  v_deg := public.session_run_degradation(v_sid);
  if (v_deg->>'degradation_pct')::numeric is distinct from 25.0 then
    raise exception '가드: 저하율이 25.0 이 아닙니다 (%)', v_deg->>'degradation_pct';
  end if;
  if v_deg->>'grade' <> 'fair' then
    raise exception '가드: 저하율 등급이 fair 가 아닙니다 (%)', v_deg->>'grade';
  end if;
  if (v_deg->>'laps')::int <> 8 then
    raise exception '가드: 랩 수가 8 이 아닙니다';
  end if;

  -- RLS 가 켜져 있고 명령별 정책이 하나씩인지
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'runs') <> 4
     or (select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'run_splits') <> 4 then
    raise exception '가드: runs/run_splits 정책 수가 명령별 1개가 아닙니다';
  end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm <> '__guard_rollback__' then raise; end if;
end $$;
