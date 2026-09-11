-- ============================================================
-- Roxlogy — 정지 계정(profiles.disabled)을 Data API·RPC·MCP·Storage 경로에서도 강제 (감사 A02)
--
-- 배경: 정지는 웹 레이아웃(profile.disabled → 정지 화면)에서만 걸렸다.
--   · mcp_uid() 는 토큰 일치만 봐서, 정지 전에 발급된 MCP 토큰이 그대로 통했다.
--   · ingest_session 은 auth.uid() 만 확인해 정지 사용자의 세션 업로드를 받았다.
--   · 쓰기 RLS 96개와 authenticated 가 부를 수 있는 volatile RPC 25개는 소유권·역할만
--     봐서, 만료 전 JWT 로 PostgREST 를 직접 치면 크루 운영·게시·프로필 수정이 통했다.
--   · 관리자가 disabled 를 켜도 Auth 세션(리프레시 토큰)·MCP 토큰은 살아 있었다.
--
-- 처리:
--   0) profiles.mcp_token 의 not null 을 푼다 — 회수 = null.
--   1) is_account_active(): auth.uid() 기준 활성 여부. RLS 의 공통 조건.
--   2) mcp_uid(): disabled 면 null (시그니처·grant 유지). 모든 mcp_* 의 공통 관문.
--   3) 정지 시 회수: disabled 가 false→true 로 바뀌면 AFTER 트리거가
--      revoke_account_access() 를 호출해 auth.sessions 삭제(리프레시 토큰은 FK cascade)
--      + mcp_token = null. admin_update_profile 뿐 아니라 관리자의 직접 UPDATE 도 잡힌다.
--      auth 스키마는 SECURITY DEFINER 함수 안에서만 만진다.
--      + 정지 계정에는 어떤 경로로도 MCP 토큰을 새로 심을 수 없다(BEFORE 트리거).
--   4) ingest_session(): 정지 사용자는 'account_disabled' 로 거부. 반환 모양은 그대로.
--   5) **단일 관문** rox_pre_request(): PostgREST 가 모든 Data API 요청 직전에 부르는
--      pre-request 함수(`pgrst.db_pre_request`, Supabase 공식 문서 "Securing your API").
--      정지 계정의 GET/HEAD 외 요청 — 테이블 INSERT/UPDATE/DELETE, POST /rpc/* 전부 —
--      를 42501 'account_disabled'(HTTP 403) 로 거부한다. 쓰기 정책 96개·RPC 25개를
--      하나씩 고치는 대신 여기 한 곳이 REST·RPC·GraphQL 을 모두 막는다.
--   6) 핵심 사용자 데이터 쓰기 RLS(sessions·session_segments·erg_samples·race_plans·
--      crew_event_rsvps)의 **기존** 정책에 AND (select is_account_active()) 를 합친다 —
--      정책 개수·이름은 그대로(alter policy). 관문이 풀려도 남는 2차 방어선.
--      Storage API 는 pre-request 를 거치지 않으므로(문서 명시) storage.objects 의
--      크루 로고 쓰기 정책 3개에도 같은 조건을 합친다.
--   7) 토큰을 직접 조회(`mcp_token = p_token`)하던 MCP RPC(mcp_dues·mcp_set_dues_paid)를
--      mcp_uid() 경유로 바꾼다 — 감사 권고 "직접 조회 RPC 점검". (mcp_report_dues 는
--      085 가 재정의하면서 이미 mcp_uid() 로 바꿨다.) 가드가 카탈로그에서 직접 비교가
--      남은 함수가 없는지 확인한다.
--   8) 이미 정지된 계정에 소급 회수.
--   9) 가드: 활성 프로필 하나를 관리자 경로로 임시 정지해 위 전부를 확인하고 롤백.
--
-- 남는 것(의도·확인된 한계):
--   · 이미 발급된 access JWT 는 만료(대시보드 설정, 기본 1시간)까지 서명이 유효하다.
--     그 동안 PostgREST 로의 **읽기(GET/HEAD)** 는 RLS 가 허용하는 자기 데이터에 한해
--     된다 — 앱은 정지 화면만 보여 주고, 쓰기·RPC 호출·MCP·Edge 업로드는 위 1~7 이
--     거부한다. GoTrue 는 auth.sessions 를 대조하므로 getUser()/리프레시는 즉시 실패한다.
--   · `pgrst.db_pre_request` 는 Data API(PostgREST)에만 적용된다. Storage 는 6) 의
--     정책으로 막고, Realtime 은 이 앱이 쓰기 경로로 쓰지 않는다(web 에 채널 사용 없음).
--   · PostgREST 는 `notify pgrst, 'reload config'` 를 받아야 새 설정을 읽는다(커밋 시
--     전달). 적용 뒤 실제 요청으로 한 번 확인할 것 — 이 파일은 함수의 판정만 검증한다.
--   · 재활성화(disabled true→false)는 아무것도 복구하지 않는다: 사용자는 재로그인하고,
--     MCP 토큰은 084 의 mcp_token_regen() 으로 다시 발급받는다.
--
-- 되돌리기(수동): 파일 끝 "롤백 메모" 참조.
-- ============================================================

-- 0) mcp_token 을 비울 수 있어야 한다. 084(mcp_token_revoke)가 같은 이유로 이미
--    not null 을 풀지만, 이 파일 혼자서도 성립하도록 한 번 더 둔다(이미 nullable 이면
--    no-op). admin_user_detail 의 has_mcp_token 과 설정 화면(`profile?.mcp_token ?? ""`)
--    은 null 을 전제로 쓰여 있다. 새 프로필의 기본값(자동 발급)은 그대로 둔다.
alter table public.profiles alter column mcp_token drop not null;

-- 1) 활성 여부 헬퍼 -----------------------------------------------------------
-- RLS 정책식 안에서 호출되므로 정책을 평가하는 역할(anon·authenticated)에 EXECUTE 가
-- 있어야 한다 — is_admin()·is_crew_member() 와 같은 이유. 없으면 정책 평가 자체가
-- permission denied 로 죽는다. 인자가 없고 auth.uid() 본인의 플래그만 돌려주므로
-- 다른 사용자 정보는 노출되지 않는다. JWT 가 없으면 false.
create or replace function public.is_account_active()
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select not p.disabled from profiles p where p.id = auth.uid()), false);
$$;
comment on function public.is_account_active() is
  '호출자(auth.uid()) 프로필이 있고 정지되지 않았으면 true. JWT 없으면 false. '
  '쓰기 RLS 의 공통 조건 — 정책식에서는 (select is_account_active()) 로 감싸 한 번만 평가.';
grant execute on function public.is_account_active() to anon, authenticated;

-- 2) MCP 공통 관문: 정지 계정은 토큰이 맞아도 "없는 사용자" ----------------------
-- create or replace 라 기존 grant(anon·authenticated)는 유지된다.
create or replace function public.mcp_uid(p_token text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select id from profiles
  where p_token is not null and length(p_token) >= 24
    and mcp_token = p_token
    and not disabled;
$$;

-- 3) 정지 시 회수 --------------------------------------------------------------
create or replace function public.revoke_account_access(p_user uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_prev text;
begin
  -- 리프레시 토큰 무효화. auth.refresh_tokens·auth.mfa_amr_claims 는 auth.sessions 를
  -- on delete cascade 로 참조하므로 sessions 만 지우면 된다.
  delete from auth.sessions where user_id = p_user;

  -- MCP 토큰 회수. profiles_privileged_guard(마이그레이션 042)는 JWT 가 있는 갱신에서
  -- mcp_token 변경을 무조건 막는다 — 관리자 JWT 로 admin_update_profile 을 부른 경우가
  -- 여기 해당한다. 이 한 문장만 우회 플래그를 켜고, 트랜잭션 안의 이전 값은 복원한다.
  v_prev := coalesce(current_setting('rox.profile_bypass', true), '');
  perform set_config('rox.profile_bypass', '1', true);
  update profiles set mcp_token = null where id = p_user and mcp_token is not null;
  perform set_config('rox.profile_bypass', v_prev, true);
end;
$$;
comment on function public.revoke_account_access(uuid) is
  '정지 처리의 부수 동작: Auth 세션 삭제(리프레시 무효화) + MCP 토큰 회수. '
  '내부용 — 트리거·마이그레이션에서만 호출. 클라이언트 grant 금지.';
revoke all on function public.revoke_account_access(uuid) from public, anon, authenticated;

create or replace function public.profiles_disable_revoke() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.revoke_account_access(new.id);
  return null;
end;
$$;
revoke all on function public.profiles_disable_revoke() from public, anon, authenticated;

-- AFTER 이므로 disabled 는 이미 저장된 뒤다. 회수 함수 안의 중첩 UPDATE(mcp_token=null)
-- 는 old.disabled 가 이미 true 라 WHEN 조건에 걸리지 않아 재귀하지 않는다.
drop trigger if exists profiles_disable_revoke on public.profiles;
create trigger profiles_disable_revoke
  after update of disabled on public.profiles
  for each row
  when (new.disabled and not old.disabled)
  execute function public.profiles_disable_revoke();

-- 정지 계정에는 MCP 토큰을 새로 심을 수 없다. 084 의 mcp_token_regen() 은 본인 JWT 만
-- 확인하고 disabled 를 보지 않는다 — 관문(5)이 POST /rpc 를 막지만, 관문을 거치지 않는
-- 경로(service_role·마이그레이션·앞으로 생길 RPC)까지 한 곳에서 막으려면 행 자체에서
-- 거부하는 것이 확실하다. 회수(null 로 지움)와 재활성화 뒤의 재발급은 통과한다.
-- BEFORE 트리거는 이름순으로 실행되므로 profiles_privileged_guard 보다 먼저 돈다.
create or replace function public.profiles_disabled_token_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.disabled and new.mcp_token is not null
     and new.mcp_token is distinct from old.mcp_token then
    raise exception 'account_disabled' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_disabled_token_guard() from public, anon, authenticated;

drop trigger if exists profiles_disabled_token_guard on public.profiles;
create trigger profiles_disabled_token_guard
  before update of mcp_token on public.profiles
  for each row execute function public.profiles_disabled_token_guard();

-- 4) ingest_session: 정지 사용자 거부 ------------------------------------------
-- 본문은 마이그레이션 026 의 최신 정의를 그대로 옮기고, unauthenticated 검사 바로
-- 뒤에 account_disabled 검사만 더했다. 반환 모양은 바뀌지 않는다. 관문(5)이 먼저
-- 막지만, RPC 자체도 거부해야 관문 설정과 무관하게 성립한다.
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

  -- 정지 계정: JWT 가 아직 유효해도 받지 않는다 (감사 A02). 42501 = insufficient_privilege.
  -- Edge(ingest-session)는 이 메시지를 403 account_disabled 로 매핑한다.
  if exists (select 1 from profiles where id = uid and disabled) then
    raise exception 'account_disabled' using errcode = '42501';
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
  '직접 upsert 하면 가드가 빠지므로 금지. 정지 계정은 account_disabled 로 거부.';

-- 5) Data API 단일 관문 --------------------------------------------------------
-- PostgREST 는 역할 전환·JWT 클레임 설정 직후, 요청의 SQL 을 실행하기 전에 이 함수를
-- 한 번 부른다(`pgrst.db_pre_request`). 정지 계정의 GET/HEAD 외 요청은 여기서 끝난다:
-- 테이블 INSERT/UPDATE/DELETE(PATCH·PUT·POST·DELETE), POST /rpc/*(volatile RPC 전부),
-- GraphQL(POST) — 정책이나 함수 본문을 하나씩 손대지 않아도 된다.
--
-- GET/HEAD 를 남기는 이유: PostgREST 는 GET/HEAD 를 읽기 전용 트랜잭션으로 돌리므로
-- 여기서 쓰기가 일어날 수 없고, 웹 레이아웃이 정지 화면을 띄우려면 profiles 를
-- 읽어야 한다(getCachedProfile 은 GET /profiles). 남는 읽기는 RLS 범위의 자기 데이터뿐.
--
-- 역할별 동작: JWT 없음(anon 키만) 또는 sub 없음(service_role) → auth.uid() 가 null →
-- 아무것도 하지 않는다. 프로필이 없는 사용자도 통과(fail-open) — 정지는 disabled=true
-- 일 때만이다. request.method 를 못 읽는 상황에서는 정지 계정을 막는 쪽(fail-closed).
--
-- 매 요청 비용: GET/HEAD 와 JWT 없는 요청은 조회 0회, authenticated 의 쓰기 요청만
-- profiles PK 조회 1회. 메서드 검사를 먼저 두는 이유가 그것이다.
-- 오류 코드 42501 은 PostgREST 가 authenticated 에 403 으로 매핑한다(문서 "Error Codes").
-- 'PGRST' sqlstate 로 상태를 직접 정하는 문법은 PostgREST 12+ 전용이라 쓰지 않았다.
create or replace function public.rox_pre_request()
returns void
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid    uuid;
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if v_method in ('GET', 'HEAD') then return; end if;
  v_uid := auth.uid();
  if v_uid is null then return; end if;
  if exists (select 1 from profiles p where p.id = v_uid and p.disabled) then
    raise exception 'account_disabled' using errcode = '42501',
      hint = 'This account is suspended; only read requests are served.';
  end if;
end;
$$;
comment on function public.rox_pre_request() is
  'PostgREST pre-request(pgrst.db_pre_request): 정지 계정(profiles.disabled)의 GET/HEAD 외 '
  'Data API 요청을 42501 account_disabled(403) 로 거부. 호출자 본인 행만 본다.';
-- 요청 역할 그대로 실행되므로 PostgREST 가 전환하는 세 역할 모두 EXECUTE 가 필요하다 —
-- 하나라도 빠지면 그 역할의 **모든** 요청이 permission denied 로 죽는다.
-- (인자 없음, 본인 플래그만 조회, 부수 효과는 예외뿐이라 노출되는 정보는 없다.)
revoke all on function public.rox_pre_request() from public;
grant execute on function public.rox_pre_request() to anon, authenticated, service_role;

-- authenticator* 는 supautils reserved_roles 에서 설정 변경이 허용된 역할이고, postgres 는
-- supabase_privileged_role 의 멤버다(라이브 확인). 설정은 PostgREST 가 reload config 를
-- 받을 때 읽힌다 — NOTIFY 는 트랜잭션 커밋 시점에 전달된다.
alter role authenticator set pgrst.db_pre_request = 'public.rox_pre_request';
notify pgrst, 'reload config';

-- 6) 쓰기 RLS 에 활성 조건 합치기 ----------------------------------------------
-- 기존 정책을 이름 그대로 alter policy 로 재정의한다(정책 추가 없음). 조건은 모두
-- (select is_account_active()) 로 감싸 initplan 으로 한 번만 평가되게 한다.
-- 정책이 없으면 alter policy 가 시끄럽게 실패한다 — 라이브와 이름이 같은 것을 확인했다.
-- 관문(5)이 있어도 두는 이유: 관문은 PostgREST 설정이라 리셋될 수 있고, 세션 체인은
-- 이 앱의 핵심 데이터라 DB 자체가 거부해야 한다.

-- sessions (정책 원본: 002 insert/delete, 027 update)
alter policy sessions_insert_own on public.sessions
  with check (user_id = (select auth.uid()) and (select is_account_active()));
alter policy sessions_update on public.sessions
  using ((user_id = (select auth.uid()) or (select is_admin()))
         and (select is_account_active()))
  with check ((user_id = (select auth.uid()) or (select is_admin()))
              and (select is_account_active()));
alter policy sessions_delete_own on public.sessions
  using (user_id = (select auth.uid()) and (select is_account_active()));

-- session_segments (원본: 027)
alter policy segments_insert_own on public.session_segments
  with check ((select is_account_active()) and exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())));
alter policy segments_update_own on public.session_segments
  using ((select is_account_active()) and exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())))
  with check ((select is_account_active()) and exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())));
alter policy segments_delete_own on public.session_segments
  using ((select is_account_active()) and exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())));

-- erg_samples (원본: 027) — 세션 소유권 체인의 raw 자식. 같은 규칙.
alter policy erg_samples_insert_own on public.erg_samples
  with check ((select is_account_active()) and exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())));
alter policy erg_samples_update_own on public.erg_samples
  using ((select is_account_active()) and exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())))
  with check ((select is_account_active()) and exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())));
alter policy erg_samples_delete_own on public.erg_samples
  using ((select is_account_active()) and exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())));

-- race_plans (원본: 20260813000001, `for all` 한 개). for all 의 USING 은 SELECT 에도
-- 걸리므로 정지 사용자는 자기 참가 일정을 직접 읽는 것도 막힌다 — 정지 계정이니
-- 허용. 크루 달력이 남의 일정을 읽는 경로는 SECURITY DEFINER RPC 라 영향 없다.
-- (for all 을 명령별로 쪼개는 정리는 이 마이그레이션 범위 밖 — 정책 추가 금지.)
alter policy race_plans_own on public.race_plans
  using (user_id = (select auth.uid()) and (select is_account_active()))
  with check (user_id = (select auth.uid()) and (select is_account_active()));

-- crew_event_rsvps (원본: 056). 스태프 분기도 함께 묶는다 — 정지된 운영진도 막힌다.
alter policy crew_event_rsvps_upsert_self on public.crew_event_rsvps
  with check (
    (select is_account_active())
    and user_id = (select auth.uid())
    and exists (
      select 1 from crew_events e
      where e.id = event_id and is_crew_member(e.crew_id) and e.closed_at is null
    )
  );
alter policy crew_event_rsvps_update on public.crew_event_rsvps
  using (
    (select is_account_active()) and (
      (user_id = (select auth.uid()) and exists (
         select 1 from crew_events e where e.id = event_id and e.closed_at is null))
      or exists (
        select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id))
    )
  ) with check (
    (select is_account_active()) and (
      (user_id = (select auth.uid()) and exists (
         select 1 from crew_events e where e.id = event_id and e.closed_at is null))
      or exists (
        select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id))
    )
  );
alter policy crew_event_rsvps_delete_self on public.crew_event_rsvps
  using (
    (select is_account_active()) and (
      (user_id = (select auth.uid()) and exists (
         select 1 from crew_events e where e.id = event_id and e.closed_at is null))
      or exists (
        select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id))
    )
  );

-- storage.objects 크루 로고 (원본: 20260811000001, `to authenticated`). Storage API 는
-- PostgREST 관문을 거치지 않으므로 정지된 운영진의 로고 업로드·교체·삭제는 여기서
-- 막아야 한다. 테이블 소유자는 supabase_storage_admin 이지만 supautils policy_grants
-- 가 postgres 에 storage.objects 의 CREATE/ALTER/DROP POLICY 를 허용한다(라이브 확인).
-- 스키마가 다르므로 함수는 모두 public. 을 붙인다. `to authenticated` 는 유지된다.
alter policy crew_logos_staff_insert on storage.objects
  with check (
    bucket_id = 'crew-logos'
    and (select public.is_account_active())
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  );
alter policy crew_logos_staff_update on storage.objects
  using (
    bucket_id = 'crew-logos'
    and (select public.is_account_active())
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'crew-logos'
    and (select public.is_account_active())
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  );
alter policy crew_logos_staff_delete on storage.objects
  using (
    bucket_id = 'crew-logos'
    and (select public.is_account_active())
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  );

-- 7) 토큰을 직접 조회하던 MCP RPC → mcp_uid() 경유 ------------------------------
-- 정지 시 mcp_token 이 null 이 되어 실질적으로는 막히지만, mcp_uid() 를 거치지 않는
-- 함수는 "토큰이 맞으면 통과"라는 옛 규칙이 남아 재발급·복원 같은 경로에서 다시
-- 열릴 수 있다. 두 함수 모두 시그니처·grant·반환 모양은 그대로이고, 조회 한 줄만 바꾼다.
-- (mcp_report_dues 는 085 가 같은 방식으로 이미 고쳤으므로 여기서 다시 정의하지 않는다 —
--  두 파일이 같은 함수를 정의하면 적용 순서에 따라 한쪽 수정이 사라진다.)

-- mcp_dues (원본: 036, 라이브 본문과 동일 확인)
create or replace function public.mcp_dues(
  p_token text, p_slug text, p_month text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_uid uuid; v_period text; v_staff boolean;
begin
  v_uid := mcp_uid(p_token);
  if v_uid is null then return null; end if;
  select c.id into v_crew from crews c
   join crew_members m on m.crew_id = c.id and m.user_id = v_uid and m.status = 'active'
   where c.slug = p_slug;
  if v_crew is null then return null; end if;
  v_period := coalesce(p_month, to_char(app_today(), 'YYYY-MM'));
  select exists (select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = v_uid and m.role in ('owner','coach'))
    into v_staff;

  return jsonb_build_object(
    'period', v_period,
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'charge_id', ch.id, 'kind', ch.kind, 'label', ch.label,
        'amount', ch.amount, 'status', ch.status) order by ch.created_at)
      from crew_dues_charges ch
      where ch.crew_id = v_crew and ch.user_id = v_uid and ch.period = v_period), '[]'::jsonb),
    'crew', case when v_staff then coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', ch.user_id, 'name', coalesce(p.display_name, 'Athlete'),
        'charge_id', ch.id, 'kind', ch.kind, 'label', ch.label,
        'amount', ch.amount, 'status', ch.status)
        order by coalesce(p.display_name, 'Athlete'), ch.created_at)
      from crew_dues_charges ch join profiles p on p.id = ch.user_id
      where ch.crew_id = v_crew and ch.period = v_period), '[]'::jsonb) else null end
  );
end;
$$;

-- mcp_set_dues_paid (원본: 036, 라이브 본문과 동일 확인). 게이트는 이미 mcp_staff_crew
-- (085: mcp_can_write → mcp_uid) 라 정지 계정은 v_crew 가 null 이다. created_by 만
-- 직접 조회였던 것을 맞춘다.
create or replace function public.mcp_set_dues_paid(
  p_token text, p_slug text, p_user_id uuid, p_month text, p_amount int default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_charge uuid; v_tier uuid;
begin
  if v_crew is null then return null; end if;
  if p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('error', 'bad_period_format');
  end if;

  select id into v_charge from crew_dues_charges
   where crew_id = v_crew and user_id = p_user_id and period = p_month and kind = 'monthly';
  if v_charge is null then
    if p_amount is null or p_amount <= 0 then
      return jsonb_build_object('error', 'no_charge_and_no_amount');
    end if;
    select tier_id into v_tier from crew_members where crew_id = v_crew and user_id = p_user_id;
    insert into crew_dues_charges
      (crew_id, user_id, kind, label, amount, period, tier_id, created_by)
    values (v_crew, p_user_id, 'monthly', p_month || ' 월회비', p_amount, p_month, v_tier,
            mcp_uid(p_token))
    returning id into v_charge;
  elsif p_amount is not null and p_amount > 0 then
    update crew_dues_charges set amount = p_amount where id = v_charge and status <> 'confirmed';
  end if;

  perform public.confirm_dues_charge(v_charge);
  return jsonb_build_object('ok', true, 'charge_id', v_charge);
end;
$$;

-- 8) 이미 정지된 계정에 소급 --------------------------------------------------
-- 작성 시점 라이브에는 0건이었지만, 적용 사이에 생길 수 있어 그대로 둔다.
do $$
declare r record; n int := 0;
begin
  for r in select id from public.profiles where disabled loop
    perform public.revoke_account_access(r.id);
    n := n + 1;
  end loop;
  raise notice '이미 정지된 계정 %건의 Auth 세션·MCP 토큰을 회수했다', n;
end $$;

-- 9) 가드 (검증 후 전부 롤백) --------------------------------------------------
-- 활성 일반 프로필 하나를 관리자 경로(admin_update_profile)로 임시 정지해
-- 헬퍼·mcp_uid·트리거 회수·토큰 재발급 차단·관문·ingest_session·RLS·MCP RPC 를 확인한다.
-- 관문은 PostgREST 가 세팅하는 GUC(request.jwt.claims·request.method)를 set_config 로
-- 흉내 내어 판정만 확인한다 — PostgREST 가 실제로 이 함수를 부르는지는 적용 뒤 요청으로
-- 확인해야 한다. 블록 끝의 '__guard_rollback__' 예외로 임시 정지·세션 삭제·토큰 회수·
-- 테스트 insert·set_config·set local role 을 전부 되돌린다(서브트랜잭션 롤백).
do $$
declare
  v_uid    uuid;
  v_tok    text;
  v_admin  uuid;
  v_ok     boolean;
  v_claims text;
begin
  -- 전제 0: 관문 설정·스토리지 정책이 카탈로그에 들어갔다
  if not exists (
    select 1 from pg_roles
    where rolname = 'authenticator'
      and rolconfig @> array['pgrst.db_pre_request=public.rox_pre_request']) then
    raise exception '가드: authenticator 에 pgrst.db_pre_request 가 설정되지 않았다';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in ('crew_logos_staff_insert', 'crew_logos_staff_update',
                            'crew_logos_staff_delete')
         and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_account_active%') <> 3 then
    raise exception '가드: storage.objects 크루 로고 정책 3개에 활성 조건이 빠졌다';
  end if;
  -- 전제 0': 토큰을 직접 비교하는 함수는 mcp_uid 하나뿐이어야 한다(036·085·이 파일의 합).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname <> 'mcp_uid'
      and p.prosrc like '%mcp_token = p_token%') then
    raise exception '가드: mcp_token 을 직접 비교하는 함수가 남아 있다: %', (
      select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname <> 'mcp_uid'
        and p.prosrc like '%mcp_token = p_token%');
  end if;

  select id, mcp_token into v_uid, v_tok
    from public.profiles
   where not disabled and not is_admin and mcp_token is not null
   limit 1;
  if v_uid is null then
    raise notice '가드 건너뜀: 정지 테스트에 쓸 활성 일반 프로필이 없다';
    return;
  end if;
  select id into v_admin from public.profiles where is_admin and not disabled limit 1;
  v_claims := json_build_object('sub', v_uid::text, 'role', 'authenticated')::text;

  -- (a) 정지 전 — 양성 대조: 토큰이 풀리고, 활성이고, 관문이 POST 를 통과시키고,
  --     본인 세션 insert 가 RLS 를 통과하고, 직접 조회를 걷어낸 MCP RPC 가 호출된다
  if public.mcp_uid(v_tok) is distinct from v_uid then
    raise exception '가드: 정지 전인데 mcp_uid 가 사용자를 못 찾는다';
  end if;
  -- 없는 슬러그라 쓰기 없이 null 로 끝나지만, mcp_uid 경유 본문이 실제로 실행된다
  perform public.mcp_dues(v_tok, '__guard_no_such_crew__');

  perform set_config('request.jwt.claims', v_claims, true);
  if not public.is_account_active() then
    raise exception '가드: 정지 전인데 is_account_active 가 false';
  end if;
  perform set_config('request.method', 'POST', true);
  perform public.rox_pre_request();   -- 활성 계정은 어떤 메서드든 통과
  -- postgres 는 bypassrls 라 RLS 를 보려면 실제 클라이언트 역할로 내려가야 한다
  set local role authenticated;
  insert into public.sessions (id, user_id, source_device, started_at)
  values (gen_random_uuid(), v_uid, 'web', now());
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.method', '', true);

  -- (b) 정지 — 관리자가 있으면 실제 경로(관리자 JWT → admin_update_profile) 로.
  --     이때 트리거 안의 mcp_token=null 갱신은 privileged_guard 를 우회 플래그로 지나야 한다.
  if v_admin is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    perform public.admin_update_profile(v_uid, '{"disabled": true}'::jsonb);
    perform set_config('request.jwt.claims', '', true);
  else
    raise notice '가드: 관리자 프로필이 없어 직접 UPDATE 로 정지한다';
    update public.profiles set disabled = true where id = v_uid;
  end if;

  if public.mcp_uid(v_tok) is not null then
    raise exception '가드: 정지 후에도 mcp_uid 가 사용자를 돌려준다';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and mcp_token is not null) then
    raise exception '가드: 정지 후 mcp_token 이 회수되지 않았다';
  end if;
  if exists (select 1 from auth.sessions where user_id = v_uid) then
    raise exception '가드: 정지 후 auth.sessions 가 남아 있다';
  end if;
  if public.mcp_dues(v_tok, '__guard_no_such_crew__') is not null then
    raise exception '가드: 정지 후에도 mcp_dues 가 응답한다';
  end if;

  -- 정지 계정에 토큰을 다시 심는 것은 어떤 경로든 거부된다(JWT 없는 갱신 = 신뢰 경계 안,
  -- 그래도 막혀야 한다). 084 의 mcp_token_regen 이 하는 UPDATE 와 같은 문장이다.
  v_ok := false;
  begin
    update public.profiles set mcp_token = v_tok where id = v_uid;
  exception when insufficient_privilege then
    if sqlerrm not like '%account_disabled%' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 정지 계정에 MCP 토큰이 다시 발급됐다'; end if;

  -- (c) 정지 후 — 정지 전 JWT(클레임)로 헬퍼·관문·RPC·RLS 가 전부 거부해야 한다
  perform set_config('request.jwt.claims', v_claims, true);
  if public.is_account_active() then
    raise exception '가드: 정지 후에도 is_account_active 가 true';
  end if;

  -- 관문: GET/HEAD 만 통과, 나머지는 42501 account_disabled, 메서드를 모르면 거부
  perform set_config('request.method', 'GET', true);
  perform public.rox_pre_request();
  perform set_config('request.method', 'HEAD', true);
  perform public.rox_pre_request();
  v_ok := false;
  begin
    perform set_config('request.method', 'POST', true);
    perform public.rox_pre_request();
  exception when insufficient_privilege then
    if sqlerrm not like '%account_disabled%' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 정지 계정의 POST 가 관문을 통과했다'; end if;
  v_ok := false;
  begin
    perform set_config('request.method', 'PATCH', true);
    perform public.rox_pre_request();
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 정지 계정의 PATCH 가 관문을 통과했다'; end if;
  v_ok := false;
  begin
    perform set_config('request.method', '', true);
    perform public.rox_pre_request();
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 메서드를 모르는 요청이 관문을 통과했다(fail-open)'; end if;
  -- JWT 없는 요청(anon 키만·service_role)은 관문이 관여하지 않는다
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.method', 'POST', true);
  perform public.rox_pre_request();
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.method', '', true);

  v_ok := false;
  begin
    perform public.ingest_session(jsonb_build_object('session', jsonb_build_object(
      'id', gen_random_uuid(), 'started_at', now(), 'client_updated_at', now())));
  exception when others then
    if sqlerrm like '%account_disabled%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception '가드: 정지 계정의 ingest_session 이 통과했다'; end if;

  set local role authenticated;
  v_ok := false;
  begin
    insert into public.sessions (id, user_id, source_device, started_at)
    values (gen_random_uuid(), v_uid, 'web', now());
  exception when insufficient_privilege then
    v_ok := true;   -- 42501: RLS with check 위반
  end;
  reset role;
  if not v_ok then raise exception '가드: 정지 계정의 sessions insert 가 RLS 를 통과했다'; end if;
  perform set_config('request.jwt.claims', '', true);

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;

-- 롤백 메모 (수동) --------------------------------------------------------------
-- alter role authenticator reset pgrst.db_pre_request;  notify pgrst, 'reload config';
-- drop function if exists public.rox_pre_request();
-- drop trigger if exists profiles_disabled_token_guard on public.profiles;
-- drop function if exists public.profiles_disabled_token_guard();
-- drop trigger if exists profiles_disable_revoke on public.profiles;
-- drop function if exists public.profiles_disable_revoke();
-- drop function if exists public.revoke_account_access(uuid);
-- mcp_uid            → 20260825000006 의 정의로 create or replace
-- ingest_session     → 20260830000026 의 정의로 create or replace
-- mcp_dues·mcp_set_dues_paid → 20260906000036 의 정의로 (mcp_report_dues 는 085 소유)
-- 정책               → sessions 002/027, session_segments·erg_samples 027,
--                      race_plans 20260813000001, crew_event_rsvps 056,
--                      storage.objects 20260811000001 의 식으로 alter policy
-- drop function if exists public.is_account_active();   -- 정책에서 뺀 뒤에만
-- alter table public.profiles alter column mcp_token set not null;  -- null 인 행을 먼저 채운 뒤
