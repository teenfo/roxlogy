-- PM5 확장 데이터: 스트로크(0x0035/0x0036)·스플릿(0x0037/0x0038)·힘곡선(0x003C) 저장.
-- 기존 samples(1Hz)는 그대로 두고 이벤트성 데이터를 별도 jsonb 컬럼에 담는다.
-- 세 컬럼 모두 nullable — 구버전 워치 페이로드에는 없으므로 null 로 들어간다.

alter table public.erg_samples
  add column if not exists strokes jsonb,
  add column if not exists splits jsonb,
  add column if not exists force_curves jsonb;

-- ingest_session RPC 재정의 (마이그레이션 005+심박 본문 + erg 확장 컬럼)

create or replace function public.ingest_session(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- 상한 검증 (계약: 세그먼트 ≤64, erg 샘플 총합 ≤30,000)
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

  -- 세션 멱등 업서트 + LWW 가드. tombstone(deleted_at)은 부활 금지.
  insert into sessions
    (id, user_id, source_device, sync_status, analysis_status,
     started_at, ended_at, total_time_ms, client_updated_at, deleted_at, template_id)
  values
    (sid, uid,
     coalesce(s->>'source_device', 'watch'),
     'synced', 'pending',
     (s->>'started_at')::timestamptz,
     (s->>'ended_at')::timestamptz,
     (s->>'total_time_ms')::bigint,
     cupd,
     (s->>'deleted_at')::timestamptz,
     (s->>'template_id')::uuid)
  on conflict (id) do update set
    source_device     = excluded.source_device,
    sync_status       = 'synced',
    analysis_status   = 'pending',
    started_at        = excluded.started_at,
    ended_at          = excluded.ended_at,
    total_time_ms     = excluded.total_time_ms,
    client_updated_at = excluded.client_updated_at,
    deleted_at        = coalesce(sessions.deleted_at, excluded.deleted_at),
    template_id       = excluded.template_id
  where sessions.user_id = uid
    and excluded.client_updated_at > sessions.client_updated_at;

  get diagnostics rc = row_count;
  applied := rc > 0;

  -- 세그먼트/erg raw는 세션 LWW 통과 시에만, "전체 스냅샷"으로 반영
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

    -- 스냅샷 동기화: 페이로드 최대 seq를 초과하는 꼬리 세그먼트 제거
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
$$;

-- 호출 권한: 로그인 사용자만 (anon 차단)
revoke all on function public.ingest_session(jsonb) from public;
grant execute on function public.ingest_session(jsonb) to authenticated;
