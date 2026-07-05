-- ============================================================
-- 시드 02 — 개발용 테스트 세션 (레이스 시뮬 1회분)
-- ⚠️ 개발/검증 전용. 실행 전 TARGET_USER_UUID 를 실제 가입 유저의
--    auth.users.id 로 치환할 것. 01_exercises_core.sql 선행 필요.
-- 003 마이그레이션의 멱등 키를 그대로 사용 → 재실행 안전.
-- ============================================================

do $$
declare
  v_user    uuid := 'TARGET_USER_UUID';
  v_session uuid := 'd0000000-0000-0000-0000-000000000001';
  v_start   timestamptz := now() - interval '2 days';
  v_seq     int := 0;
  v_seg     uuid;
  i         int;
  -- 스테이션 운동 id (01 시드의 고정 UUID, station_1..8 순)
  v_ex uuid[] := array[
    'e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
    'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006',
    'e0000000-0000-0000-0000-000000000007','e0000000-0000-0000-0000-000000000008'
  ];
  v_run uuid := 'e0000000-0000-0000-0000-000000000009';
  -- 대략 현실적인 스플릿(ms): 런 8회 / 스테이션 8회 / 록스존 8회
  v_run_ms  bigint[] := array[268000, 274000, 281000, 285000, 290000, 293000, 288000, 279000];
  v_st_ms   bigint[] := array[232000, 154000, 168000, 205000, 245000, 138000, 262000, 310000];
  v_rz_ms   bigint[] := array[38000, 42000, 45000, 41000, 47000, 44000, 49000, 35000];
  v_total   bigint := 0;
begin
  select sum(x) into v_total
  from unnest(v_run_ms || v_st_ms || v_rz_ms) as t(x);

  insert into public.sessions
    (id, user_id, source_device, sync_status, analysis_status,
     started_at, ended_at, total_time_ms, client_updated_at)
  values
    (v_session, v_user, 'watch', 'synced', 'pending',
     v_start, v_start + make_interval(secs => v_total / 1000.0), v_total, now())
  on conflict (id) do update set
    total_time_ms = excluded.total_time_ms,
    client_updated_at = excluded.client_updated_at
  where public.sessions.client_updated_at < excluded.client_updated_at;

  for i in 1..8 loop
    -- 런 1km
    v_seq := v_seq + 1;
    insert into public.session_segments (session_id, seq, kind, exercise_id, split_time_ms)
    values (v_session, v_seq, 'run', v_run, v_run_ms[i])
    on conflict (session_id, seq) do update set split_time_ms = excluded.split_time_ms;

    -- 록스존 트랜지션
    v_seq := v_seq + 1;
    insert into public.session_segments (session_id, seq, kind, split_time_ms)
    values (v_session, v_seq, 'roxzone', v_rz_ms[i])
    on conflict (session_id, seq) do update set split_time_ms = excluded.split_time_ms;

    -- 스테이션
    v_seq := v_seq + 1;
    insert into public.session_segments
      (session_id, seq, kind, exercise_id, machine_type, split_time_ms)
    values
      (v_session, v_seq, 'station', v_ex[i],
       case i when 1 then 'ski' when 5 then 'row' else null end, v_st_ms[i])
    on conflict (session_id, seq) do update set split_time_ms = excluded.split_time_ms
    returning id into v_seg;

    -- 에르그 스테이션(스키/로잉)엔 raw 샘플 첨부
    if i in (1, 5) then
      insert into public.erg_samples (segment_id, machine_type, samples, sample_count)
      values (
        v_seg,
        case i when 1 then 'ski' else 'row' end,
        (select jsonb_agg(jsonb_build_object(
           't', n, 'dist', n * 4.2, 'pace', 118 + (n % 7),
           'spm', 34 + (n % 5), 'watts', 240 + (n % 40), 'cal', n / 4.0))
         from generate_series(1, 240) n),
        240
      )
      on conflict (segment_id) do update set
        samples = excluded.samples, sample_count = excluded.sample_count;
    end if;
  end loop;
end $$;
