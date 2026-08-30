-- Roxlogy — ingest_session 이 웹 전용 필드까지 받도록 확장 (LWW 가드 단일화)
--
-- 배경: CLAUDE.md·마이그레이션 003 은 sessions 업서트에
--   `where excluded.client_updated_at > sessions.client_updated_at` 가드를 필수로 규정한다.
-- 워치·폰은 ingest_session RPC 를 거쳐 이 가드를 받지만, 웹의 PostgREST 직접 upsert
-- 3곳(session-new-form / race-to-session-button / race-new-form)은 조건부 업서트를
-- 표현할 수 없어 무조건 덮어썼다. 오래 열어둔 웹 수정 탭이 그 사이 워치로 동기화된
-- 최신 세그먼트를 조용히 되돌릴 수 있다.
--
-- 웹을 RPC 로 옮기려면 RPC 가 웹이 쓰는 컬럼(notes·rpe·division·race_result_id·
-- leaderboard_excluded)도 받아야 한다. 워치 페이로드에는 이 키가 없으므로
-- **키가 있을 때만** 덮어쓰고 없으면 기존 값을 보존한다(`p ? 'key'` 판정).

create or replace function public.ingest_session(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  uid          uuid := auth.uid();
  s            jsonb := p->'session';
  sid          uuid;
  cupd         timestamptz;
  rc           int;
  applied      boolean := false;
  seg          jsonb;
  seg_count    int := 0;
  sample_count int := 0;
  total_samples int := 0;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if s is null or s->>'id' is null or s->>'started_at' is null
     or s->>'client_updated_at' is null then
    raise exception 'invalid_session';
  end if;
  sid  := (s->>'id')::uuid;
  cupd := (s->>'client_updated_at')::timestamptz;

  if p ? 'segments' then
    if jsonb_typeof(p->'segments') <> 'array'
       or jsonb_array_length(p->'segments') > 64 then
      raise exception 'invalid_segments';
    end if;
    select coalesce(sum(jsonb_array_length(e->'erg'->'samples')), 0)
      into total_samples
      from jsonb_array_elements(p->'segments') e
      where e ? 'erg';
    if total_samples > 30000 then
      raise exception 'too_many_samples';
    end if;
  end if;

  insert into sessions
    (id, user_id, source_device, sync_status, analysis_status,
     started_at, ended_at, total_time_ms, client_updated_at, deleted_at, template_id,
     notes, rpe, division, race_result_id, leaderboard_excluded)
  values
    (sid, uid,
     coalesce(s->>'source_device', 'watch'),
     'synced', 'pending',
     (s->>'started_at')::timestamptz,
     (s->>'ended_at')::timestamptz,
     (s->>'total_time_ms')::bigint,
     cupd,
     (s->>'deleted_at')::timestamptz,
     (s->>'template_id')::uuid,
     s->>'notes',
     (s->>'rpe')::smallint,
     s->>'division',
     (s->>'race_result_id')::uuid,
     coalesce((s->>'leaderboard_excluded')::boolean, false))
  on conflict (id) do update set
    source_device     = excluded.source_device,
    sync_status       = 'synced',
    analysis_status   = 'pending',
    started_at        = excluded.started_at,
    ended_at          = excluded.ended_at,
    total_time_ms     = excluded.total_time_ms,
    client_updated_at = excluded.client_updated_at,
    deleted_at        = coalesce(sessions.deleted_at, excluded.deleted_at),
    template_id       = excluded.template_id,
    -- 아래 5개는 웹 전용 — 페이로드에 키가 있을 때만 덮어쓴다.
    -- 워치 재전송이 웹에서 적은 메모·RPE 를 지우면 안 된다.
    notes             = case when s ? 'notes' then excluded.notes
                             else sessions.notes end,
    rpe               = case when s ? 'rpe' then excluded.rpe
                             else sessions.rpe end,
    division          = case when s ? 'division' then excluded.division
                             else sessions.division end,
    race_result_id    = case when s ? 'race_result_id' then excluded.race_result_id
                             else sessions.race_result_id end,
    leaderboard_excluded = case when s ? 'leaderboard_excluded'
                                then excluded.leaderboard_excluded
                                else sessions.leaderboard_excluded end
  where sessions.user_id = uid
    and excluded.client_updated_at > sessions.client_updated_at;

  get diagnostics rc = row_count;
  applied := rc > 0;

  if applied and p ? 'segments' then
    for seg in select * from jsonb_array_elements(p->'segments') loop
      if seg->>'seq' is null or seg->>'kind' is null then
        raise exception 'invalid_segments';
      end if;
      insert into session_segments
        (id, session_id, seq, kind, exercise_id, machine_type,
         split_time_ms, started_at, ended_at, avg_hr, max_hr)
      values
        (coalesce((seg->>'id')::uuid, gen_random_uuid()),
         sid,
         (seg->>'seq')::int,
         seg->>'kind',
         (seg->>'exercise_id')::uuid,
         seg->>'machine_type',
         (seg->>'split_time_ms')::bigint,
         (seg->>'started_at')::timestamptz,
         (seg->>'ended_at')::timestamptz,
         (seg->>'avg_hr')::smallint,
         (seg->>'max_hr')::smallint)
      on conflict (session_id, seq) do update set
        kind          = excluded.kind,
        exercise_id   = excluded.exercise_id,
        machine_type  = excluded.machine_type,
        split_time_ms = excluded.split_time_ms,
        started_at    = excluded.started_at,
        ended_at      = excluded.ended_at,
        avg_hr        = excluded.avg_hr,
        max_hr        = excluded.max_hr;
      seg_count := seg_count + 1;

      if seg ? 'erg' then
        insert into erg_samples (segment_id, machine_type, samples, sample_count,
                                 strokes, splits, force_curves)
        select ss.id,
               seg->'erg'->>'machine_type',
               seg->'erg'->'samples',
               jsonb_array_length(seg->'erg'->'samples'),
               seg->'erg'->'strokes',
               seg->'erg'->'splits',
               seg->'erg'->'force_curves'
          from session_segments ss
         where ss.session_id = sid and ss.seq = (seg->>'seq')::int
        on conflict (segment_id) do update set
          machine_type = excluded.machine_type,
          samples      = excluded.samples,
          sample_count = excluded.sample_count,
          strokes      = excluded.strokes,
          splits       = excluded.splits,
          force_curves = excluded.force_curves;
        sample_count := sample_count + jsonb_array_length(seg->'erg'->'samples');
      end if;
    end loop;

    delete from session_segments
     where session_id = sid
       and seq > (select coalesce(max((e->>'seq')::int), 0)
                    from jsonb_array_elements(p->'segments') e);
  end if;

  return jsonb_build_object(
    'applied', applied,
    'session_id', sid,
    'segments_upserted', seg_count,
    'samples_upserted', sample_count
  ) || case when applied then '{}'::jsonb
            else jsonb_build_object('reason', 'stale') end;
end;
$function$;

comment on function public.ingest_session(jsonb) is
  '세션 수신 단일 진입점 — 워치·폰·웹 공통. client_updated_at LWW 가드와 '
  '세그먼트 전체 스냅샷(꼬리 삭제) 규칙을 내장한다. 클라이언트가 sessions 를 '
  '직접 upsert 하면 가드가 빠지므로 금지.';
