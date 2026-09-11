-- ============================================================
-- Roxlogy — 푸시 발송 재시도(임대·백오프·기기별 추적) + Web Push endpoint 허용 목록 (감사 A05·R02)
--
-- A05 배경: push-dispatch 가 큐(notifications) 행을 가져오면서 sent_at 을 먼저 찍었다.
--   그 뒤 외부 발송(web-push/FCM)이 503·타임아웃으로 실패해도 되돌리지 않아 일시 장애가
--   알림 누락으로 굳었다("보냈다"는 기록이 거짓). 재현: 503 주입 → 첫 실행 sent=0/failed=1,
--   다음 실행 dispatched=0.
-- 처리(덧붙이기만 — 컬럼 삭제·이름 변경 없음, 옛 코드는 새 컬럼을 무시하고 지나간다):
--   1) notifications 에 claimed_at(임대 시각)·attempts·next_attempt_at·last_error·failed_at·
--      delivered_sub_ids(이미 받은 구독 id 집합) 추가.
--   2) claim_push_notifications(): "임대"로 원자적으로 가져온다 — sent_at 은 건드리지 않는다.
--      조건: sent_at·failed_at 없음, 24h 이내, (미임대 또는 임대 5분 경과), (재시도 시각 도래).
--      FOR UPDATE SKIP LOCKED 라 동시 실행이 같은 행을 잡지 않는다. 실행 중단(크래시)이면
--      5분 뒤 임대가 만료돼 다시 잡힌다. 반환에 delivered_sub_ids 를 포함해 발송기가 이미 받은
--      기기를 제외하고 실패한 기기만 다시 보낸다 — "성공하지 않은 대상"이 기기 단위로 재처리된다.
--   3) settle_push_notifications(): 발송 결과 정산.
--      sent   → 남은 대상이 전부 성공(또는 이전 시도에서 이미 받음): sent_at.
--      retry  → 실패한 기기가 하나라도 있음: attempts+1, 백오프 1m→5m→30m. 이번에 받은 기기는
--               delivered_sub_ids 에 합쳐 다음 시도에서 제외(중복 발송 없음). 4번째 실패면 종결 —
--               한 기기라도 받았으면 sent_at(부분 완료, last_error 에 요약), 아니면 failed_at.
--      drop   → 보낼 대상이 없음(구독 없음/전부 죽음/전부 거부): failed_at + 사유. 다만 이전 시도에서
--               받은 기기가 있으면 sent_at 으로 종결한다.
--      release→ 인프라 실패(구독 조회 불가)·실행 예산 초과처럼 대상에게 시도조차 못 한 경우:
--               임대만 풀고 attempts 는 올리지 않는다(다음 분 크론이 그대로 다시 잡는다).
--      sent_at 과 failed_at 은 배타 — 모든 분기가 둘 다 null 인 행에만 적용된다.
--   두 함수 모두 호출자 검증이 없는 SECURITY DEFINER → anon/authenticated grant 금지.
--   Edge(service role)만 호출한다. pg_cron 1분 주기는 그대로(백오프는 분 단위라 맞물린다).
--   4) 트리거 notifications_client_update_guard: 클라이언트 역할(anon·authenticated)은 본인 알림의
--      read_at 만 바꿀 수 있다. notif_update_own(0716) 이 모든 컬럼 갱신을 허용해 사용자가 자기 행의
--      sent_at/attempts/next_attempt_at 를 되돌려 크론이 자기 기기로 반복 발송하게 만들 수 있었다
--      (새 컬럼으로 표면이 넓어져 여기서 닫는다). 웹은 read_at 만 갱신한다(notification-list.tsx).
--
-- R02 배경: push_subscriptions.endpoint 는 사용자가 RLS(본인 행)로 임의 값을 넣을 수 있고
--   발송 함수가 그 URL 로 그대로 요청했다(SSRF). 저장(CHECK)·발송(Edge) 양쪽에서 같은 규칙으로
--   막는다. 허용 호스트 근거(실제 브라우저 Web Push 엔드포인트):
--     · fcm.googleapis.com — Chrome·Edge(Chromium)·Opera·Brave·Samsung Internet
--       (/fcm/send/…, /wp/…) https://developer.chrome.com/blog/web-push-interop-wins
--     · updates.push.services.mozilla.com — Firefox(autopush)
--       https://github.com/mozilla-services/autopush
--     · web.push.apple.com 및 *.push.apple.com — Safari(macOS·iOS 16.4+). Apple/WebKit 문서가
--       "push.apple.com 의 모든 하위 도메인을 허용"하라고 안내 https://webkit.org/blog/12945/meet-web-push/
--     · *.notify.windows.com, *.wns.windows.com — 구 EdgeHTML(WNS, 예: wns2-bl2p.notify.windows.com/w/)
--   IP 리터럴·사설 주소는 위 목록에 있을 수 없으므로 자동 배제. https 만, 포트는 기본(443)만.
--   경로 문자는 RFC 3986 의 URL 문자만(공백·#·백슬래시·제어문자 거부) — Edge/web 의 JS 검사기는
--   같은 정규식을 원문에 적용한 뒤 URL 파서로 한 번 더 확인하므로 두 계층의 판정이 같다.
--   기존 행 중 위반이 있어도 마이그레이션이 죽지 않게 NOT VALID 로 추가한 뒤, 위반이 0건이면
--   바로 VALIDATE 한다(있으면 origin·건수를 notice 로 남기고 NOT VALID 로 둔다 — 운영자가
--   정리 후 `alter table … validate constraint push_subscriptions_endpoint_allowed_chk`).
--   2026-09-11 운영 조회: web 구독 1행, origin=https://fcm.googleapis.com → 위반 0.
--
-- 되돌리기(수동):
--   drop trigger if exists notifications_client_update_guard_trg on public.notifications;
--   drop function if exists public.notifications_client_update_guard();
--   alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_allowed_chk;
--   drop function if exists public.is_push_endpoint_allowed(text);
--   drop function if exists public.settle_push_notifications(jsonb);
--   drop function if exists public.claim_push_notifications(integer);
--   drop index if exists public.notifications_pending_idx;
--   alter table public.notifications drop column if exists claimed_at, drop column if exists attempts,
--     drop column if exists next_attempt_at, drop column if exists last_error, drop column if exists failed_at,
--     drop column if exists delivered_sub_ids;
--   (옛 push-dispatch 는 sent_at 만 보므로 컬럼을 지워도 동작한다.)
-- ============================================================

-- 1) 큐 컬럼 덧붙이기 -----------------------------------------------------------
alter table public.notifications
  add column if not exists claimed_at        timestamptz,
  add column if not exists attempts          integer not null default 0,
  add column if not exists next_attempt_at   timestamptz,
  add column if not exists last_error        text,
  add column if not exists failed_at         timestamptz,
  add column if not exists delivered_sub_ids uuid[] not null default '{}'::uuid[];

comment on column public.notifications.claimed_at is
  '발송기(push-dispatch)의 임대 시각. 5분 지나면 만료로 보고 다시 잡는다. 정산 시 null.';
comment on column public.notifications.attempts is
  '실패한 기기가 남은 채 끝난 발송 시도 횟수. 3회 초과(4번째 실패)면 종결(한 기기라도 받았으면 sent_at, 아니면 failed_at).';
comment on column public.notifications.next_attempt_at is
  '다음 재시도 가능 시각(백오프 1m→5m→30m). null 이면 즉시 가능.';
comment on column public.notifications.last_error is
  '마지막 정산 요약(성공/실패/정리/거부 건수와 오류). 일부 기기만 성공해도 남긴다.';
comment on column public.notifications.failed_at is
  '종결 시각 — 한 기기에도 전달하지 못한 채 재시도 소진 또는 보낼 구독이 없음(last_error 참조). sent_at 과 배타.';
comment on column public.notifications.delivered_sub_ids is
  '이미 전달에 성공한 push_subscriptions.id 집합. 재시도 때 이 기기는 제외한다(FK 없음 — 구독이 지워져도 기록은 남긴다).';

-- 클레임 스캔은 "미정산 행"만 훑는다 — 표가 커져도 부분 인덱스로 상수 비용.
create index if not exists notifications_pending_idx
  on public.notifications (created_at)
  where sent_at is null and failed_at is null;

-- 2) 임대 클레임 ---------------------------------------------------------------
-- 반환 모양이 초안(미적용)과 달라 create or replace 가 아니라 drop 후 create 한다 — 운영에는 아직 없는 함수.
drop function if exists public.claim_push_notifications(integer);
create function public.claim_push_notifications(p_limit integer default 200)
returns table (
  id uuid, user_id uuid, type_key text, title text, body text, url text, data jsonb,
  attempts integer, delivered_sub_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  with cand as (
    select n.id
    from public.notifications n
    where n.sent_at is null
      and n.failed_at is null
      -- 24시간 넘게 미발송이면 만료로 간주(디스패치 장기 중단 후 몰아치기 방지) — 기존 규칙 유지
      and n.created_at >= now() - interval '24 hours'
      and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
      and (n.next_attempt_at is null or n.next_attempt_at <= now())
    order by n.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  )
  update public.notifications n
     set claimed_at = now()
    from cand
   where n.id = cand.id
  returning n.id, n.user_id, n.type_key, n.title, n.body, n.url, n.data, n.attempts, n.delivered_sub_ids;
end;
$fn$;
comment on function public.claim_push_notifications(integer) is
  '미발송 알림을 임대(claimed_at=now())로 원자적으로 가져온다. sent_at 은 실제 발송 성공 뒤 '
  'settle_push_notifications 가 찍는다. delivered_sub_ids 의 기기는 이미 받았으니 제외하고 보낼 것. '
  '내부용(Edge push-dispatch, service role) — 클라이언트 grant 금지.';
revoke all on function public.claim_push_notifications(integer) from public, anon, authenticated;

-- 3) 정산 ----------------------------------------------------------------------
-- p_results: [{ "id": uuid, "outcome": "sent"|"retry"|"drop"|"release", "error": text|null,
--               "delivered": [uuid, …] (이번 실행에서 실제로 받은 push_subscriptions.id, 생략 가능) }, …]
create or replace function public.settle_push_notifications(p_results jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n   integer := 0;
  r     record;
  v_new uuid[];
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'settle_push_notifications: array expected';
  end if;

  for r in
    select (e->>'id')::uuid as id,
           e->>'outcome'     as outcome,
           left(e->>'error', 1000) as err,
           e->'delivered'    as delivered
    from jsonb_array_elements(p_results) e
  loop
    -- 이번 실행에서 받은 구독 id. 모양이 틀리면 조용히 넘기지 않고 전체 정산을 거부한다(발송기 버그 조기 발견).
    if r.delivered is null or jsonb_typeof(r.delivered) = 'null' then
      v_new := '{}'::uuid[];
    elsif jsonb_typeof(r.delivered) = 'array' then
      select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_new
        from jsonb_array_elements_text(r.delivered) x;
    else
      raise exception 'settle_push_notifications: delivered must be an array (id=%)', r.id;
    end if;

    if r.outcome = 'sent' then
      -- 남은 대상이 전부 성공(또는 이전 시도에서 이미 받음) → 완료. 일부 정리/거부 요약은 last_error 에.
      -- failed_at 가드: 늦은 정산이 종결된 행을 "발송+실패" 모순 상태로 만들지 않게 한다.
      update public.notifications n
         set sent_at           = now(),
             claimed_at        = null,
             next_attempt_at   = null,
             last_error        = r.err,
             delivered_sub_ids = (select coalesce(array_agg(distinct x), '{}'::uuid[])
                                    from unnest(n.delivered_sub_ids || v_new) as x)
       where n.id = r.id and n.sent_at is null and n.failed_at is null;

    elsif r.outcome = 'retry' then
      -- 실패한 기기가 남았다: 시도 횟수를 올리고 백오프. 1m → 5m → 30m, 그 다음(4번째 실패)은 종결.
      -- 이번에 받은 기기는 delivered_sub_ids 에 합쳐 다음 시도에서 제외한다 — 성공 기기에 중복 발송 없음.
      -- 종결 시 한 기기라도 받았으면 부분 완료(sent_at), 아무도 못 받았으면 failed_at.
      update public.notifications n
         set attempts          = n.attempts + 1,
             claimed_at        = null,
             last_error        = r.err,
             delivered_sub_ids = (select coalesce(array_agg(distinct x), '{}'::uuid[])
                                    from unnest(n.delivered_sub_ids || v_new) as x),
             next_attempt_at   = case
                                   when n.attempts + 1 >= 4 then null
                                   when n.attempts + 1 = 1  then now() + interval '1 minute'
                                   when n.attempts + 1 = 2  then now() + interval '5 minutes'
                                   else                          now() + interval '30 minutes'
                                 end,
             sent_at           = case when n.attempts + 1 >= 4 and cardinality(n.delivered_sub_ids || v_new) > 0
                                      then now() end,
             failed_at         = case when n.attempts + 1 >= 4 and cardinality(n.delivered_sub_ids || v_new) = 0
                                      then now() end
       where n.id = r.id and n.sent_at is null and n.failed_at is null;

    elsif r.outcome = 'drop' then
      -- 보낼 대상이 없다(구독 없음·전부 죽음·전부 거부). 재시도해도 결과가 같으니 종결하되
      -- sent_at 을 찍지는 않는다 — "보냈다"가 거짓이 되지 않게. 사유는 last_error.
      -- 단, 이전 시도에서 받은 기기가 있으면 그 행은 실제로 전달된 것이므로 sent_at 으로 종결한다.
      update public.notifications n
         set claimed_at        = null,
             next_attempt_at   = null,
             last_error        = r.err,
             delivered_sub_ids = (select coalesce(array_agg(distinct x), '{}'::uuid[])
                                    from unnest(n.delivered_sub_ids || v_new) as x),
             sent_at           = case when cardinality(n.delivered_sub_ids || v_new) > 0 then now() end,
             failed_at         = case when cardinality(n.delivered_sub_ids || v_new) = 0 then now() end
       where n.id = r.id and n.sent_at is null and n.failed_at is null;

    elsif r.outcome = 'release' then
      -- 대상에게 시도조차 못 했다(구독 조회 실패·실행 예산 초과). 임대만 풀고 attempts 는 그대로 —
      -- 인프라 장애가 백오프 합(36분)보다 길어도 알림이 소진 종결되지 않게. 다음 분 크론이 다시 잡는다.
      update public.notifications n
         set claimed_at = null,
             last_error = r.err
       where n.id = r.id and n.sent_at is null and n.failed_at is null;

    else
      raise exception 'settle_push_notifications: unknown outcome %', coalesce(r.outcome, 'null');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
comment on function public.settle_push_notifications(jsonb) is
  '발송 결과 정산 — sent: sent_at / retry: attempts+1·백오프(1m,5m,30m), 받은 기기는 delivered_sub_ids 에 합침, '
  '4번째 실패면 종결(한 기기라도 받았으면 sent_at, 아니면 failed_at) / drop: 대상 없음 종결(failed_at) / '
  'release: 임대만 해제(attempts 유지). 내부용(Edge push-dispatch·push-send) — 클라이언트 grant 금지.';
revoke all on function public.settle_push_notifications(jsonb) from public, anon, authenticated;

-- 4) 클라이언트는 read_at 만 갱신 가능 -------------------------------------------------
-- PostgREST 로 들어온 요청(current_user = anon/authenticated)만 대상. postgres·service_role·
-- SECURITY DEFINER 함수·pg_cron 은 신뢰 경계 안이라 그대로 통과한다. read_at 을 제외한 어떤 컬럼이든
-- 바뀌면 거부 — 나중에 컬럼이 늘어도 자동으로 보호된다(사용자가 고칠 컬럼이 생기면 여기에 예외를 추가).
create or replace function public.notifications_client_update_guard()
returns trigger
language plpgsql
as $fn$
declare
  v_cmp public.notifications;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  v_cmp := new;
  v_cmp.read_at := old.read_at;
  if v_cmp is distinct from old then
    raise exception 'notifications: 클라이언트는 read_at 만 바꿀 수 있습니다'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;
comment on function public.notifications_client_update_guard() is
  '트리거: anon/authenticated 의 UPDATE 는 read_at 변경만 허용. 큐 컬럼(sent_at·attempts·next_attempt_at 등)을 '
  '사용자가 되돌려 반복 발송을 유발하지 못하게 한다.';
drop trigger if exists notifications_client_update_guard_trg on public.notifications;
create trigger notifications_client_update_guard_trg
  before update on public.notifications
  for each row execute function public.notifications_client_update_guard();

-- 5) Web Push endpoint 허용 규칙 ---------------------------------------------------
-- 순수 함수(데이터 접근 없음). CHECK 제약식은 INSERT/UPDATE 를 실행하는 역할(authenticated)의
-- 권한으로 평가되므로 EXECUTE 가 없으면 구독 저장 자체가 permission denied 로 죽는다 —
-- is_account_active() 를 RLS 용으로 grant 한 것과 같은 이유. 노출되는 정보는 없다.
-- 규칙: https 고정, 인증정보(user@) 불가, 포트는 생략 또는 443, 호스트는 허용 목록(정확 일치
-- 또는 지정 접미사의 하위 도메인)만, 호스트 뒤에 반드시 '/' + 구독 토큰 경로 1자 이상(첫 글자는
-- '?' 불가 — "https://host/?x" 는 경로 없는 URL) — "fcm.googleapis.com.evil.com" 차단, 경로 없는
-- "https://host/" 도 거부. 경로 문자는 RFC 3986 URL 문자만: 공백·'#'(fragment)·백슬래시·제어문자 거부.
-- Edge(push-dispatch·push-send)·web(resubscribe) 의 PUSH_ENDPOINT_RE 와 문자 단위로 같은 정규식 —
-- 목록을 바꾸면 네 곳을 함께 고친다. 대소문자 무시(~*)는 JS 의 /i 플래그와 같다.
create or replace function public.is_push_endpoint_allowed(p_endpoint text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select length(p_endpoint) <= 2048
     and p_endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com|([a-z0-9-]+\.)+wns\.windows\.com)(:443)?/[a-z0-9._~:/%@!$&''()*+,;=-][a-z0-9._~:/?%@!$&''()*+,;=-]*$'
$fn$;
comment on function public.is_push_endpoint_allowed(text) is
  'Web Push endpoint 가 알려진 푸시 공급자(FCM·Mozilla autopush·APNs web push·WNS)의 https URL 인지. '
  'push_subscriptions.endpoint CHECK 와 발송 함수가 같은 규칙을 쓴다. IP 리터럴·사설 주소는 목록에 없어 배제.';
grant execute on function public.is_push_endpoint_allowed(text) to anon, authenticated;

-- 6) 기존 위반 행 조회(로그) → NOT VALID 로 제약 추가 → 위반 0건이면 즉시 검증 ----------
do $$
declare
  v_bad integer;
  r record;
begin
  select count(*) into v_bad
    from public.push_subscriptions
   where endpoint is not null and not public.is_push_endpoint_allowed(endpoint);

  if v_bad > 0 then
    raise notice 'push_subscriptions: 허용 목록 밖 endpoint % 행 — 제약은 NOT VALID 로 남긴다', v_bad;
    -- endpoint 전체는 구독 비밀(capability URL)이라 origin 만 남긴다
    for r in
      select regexp_replace(endpoint, '^([a-zA-Z]+://[^/]+).*$', '\1') as origin, count(*) as n
        from public.push_subscriptions
       where endpoint is not null and not public.is_push_endpoint_allowed(endpoint)
       group by 1 order by 2 desc
    loop
      raise notice '  origin=% n=%', r.origin, r.n;
    end loop;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.push_subscriptions'::regclass
       and conname = 'push_subscriptions_endpoint_allowed_chk'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_endpoint_allowed_chk
      check (endpoint is null or public.is_push_endpoint_allowed(endpoint))
      not valid;
  end if;

  -- NOT VALID 라도 새 INSERT/UPDATE 에는 즉시 적용된다. 기존 행 검증은 위반이 없을 때만.
  if v_bad = 0 then
    alter table public.push_subscriptions validate constraint push_subscriptions_endpoint_allowed_chk;
  end if;
end $$;

-- 7) 가드 — 실제 표에 임시 행을 넣어 검증하므로 끝에 반드시 되돌린다(__guard_rollback__) --------
-- 주의: 가드는 claim(500) 을 호출해 실제 미정산 행도 잠시 임대한다(트랜잭션 끝에 전부 롤백).
do $$
declare
  v_uid  uuid;
  v_id   uuid;   -- 한 기기에도 못 보낸 채 소진 → failed_at
  v_id2  uuid;   -- 성공 정산·drop 무시·클라이언트 트리거
  v_id3  uuid;   -- 일부 기기 성공 → 실패 기기만 재시도 → 소진 시 부분 완료(sent_at)
  v_id4  uuid;   -- 일부 성공 뒤 대상 소멸(drop) → sent_at
  v_id5  uuid;   -- release: attempts 유지, 즉시 재클레임
  v_sub1 uuid := gen_random_uuid();
  v_sub2 uuid := gen_random_uuid();
  v_cnt  integer;
  v_row  public.notifications%rowtype;
  v_claim record;
begin
  -- (a) endpoint 규칙: 허용/거부 사례 (Edge·web 의 JS 검사기와 같은 사례 집합)
  if not public.is_push_endpoint_allowed('https://fcm.googleapis.com/fcm/send/abc:APA91b')
     or not public.is_push_endpoint_allowed('https://fcm.googleapis.com/wp/abc')
     or not public.is_push_endpoint_allowed('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')
     or not public.is_push_endpoint_allowed('https://web.push.apple.com/QGxyz')
     or not public.is_push_endpoint_allowed('https://wns2-bl2p.notify.windows.com/w/?token=x')
     or not public.is_push_endpoint_allowed('https://FCM.GOOGLEAPIS.COM/X')                  -- 대소문자
     or not public.is_push_endpoint_allowed('https://fcm.googleapis.com:443/x')               -- 기본 포트 명시
     or not public.is_push_endpoint_allowed('https://a.b.push.apple.com/x')                   -- 하위 도메인
     or not public.is_push_endpoint_allowed('https://fcm.googleapis.com/x?r=http://169.254.169.254') -- 쿼리는 무관
  then
    raise exception '가드: 정상 endpoint 가 거부됩니다';
  end if;
  if public.is_push_endpoint_allowed('http://fcm.googleapis.com/fcm/send/abc')            -- http
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com.evil.com/x')          -- 접미사 위장
     or public.is_push_endpoint_allowed('https://evil.com/fcm.googleapis.com/')           -- 경로 위장
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com@evil.com/')           -- userinfo
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com:8443/x')             -- 비표준 포트
     or public.is_push_endpoint_allowed('https://127.0.0.1/x')                            -- 루프백
     or public.is_push_endpoint_allowed('https://10.0.0.1/x')                             -- 사설
     or public.is_push_endpoint_allowed('https://[::1]/x')                                -- IPv6
     or public.is_push_endpoint_allowed('https://169.254.169.254/latest/meta-data/')      -- 메타데이터
     or public.is_push_endpoint_allowed('https://0x7f000001/x')                           -- 16진 IPv4
     or public.is_push_endpoint_allowed('https://2130706433/x')                           -- 정수 IPv4
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com')                     -- 경로 없음
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com/')                    -- 경로 없음
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com/?x')                  -- 쿼리만
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com./x')                  -- 끝점 호스트
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com/#x')                  -- fragment
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com/a b')                 -- 공백
     or public.is_push_endpoint_allowed('https://fcm.googleapis.com\@evil.com/x')         -- 백슬래시
     or public.is_push_endpoint_allowed(E'https://fcm.googleapis.com/x\n')                -- 개행
     or public.is_push_endpoint_allowed('https://fcm%2egoogleapis.com/x')                 -- 퍼센트 인코딩 호스트
     or public.is_push_endpoint_allowed('https://push.apple.com/x')                       -- 접미사 자체(목록 밖)
     or public.is_push_endpoint_allowed('https://xfcm.googleapis.com/x')                  -- 접두 위장
  then
    raise exception '가드: 위험 endpoint 가 허용됩니다';
  end if;

  select id into v_uid from auth.users order by created_at limit 1;
  if v_uid is null then
    raise notice '가드: 사용자가 없어 큐·제약 검증을 건너뜁니다';
    return;
  end if;

  -- (b) CHECK 제약이 새 INSERT 를 막는다 (NOT VALID 여도 신규 행에는 적용)
  begin
    insert into public.push_subscriptions (user_id, platform, endpoint, p256dh, auth)
      values (v_uid, 'web', 'https://127.0.0.1/evil', 'k', 'a');
    raise exception '가드: 허용 목록 밖 endpoint 가 저장됩니다';
  exception
    when check_violation then null;
  end;

  -- (c) 클레임은 sent_at 을 찍지 않고 임대만 한다; 임대 중에는 다시 잡히지 않는다
  insert into public.notifications (user_id, type_key, title, body, url)
    values (v_uid, 'test', '가드', '재시도 검증', '/dashboard') returning id into v_id;
  select c.* into v_claim from public.claim_push_notifications(500) c where c.id = v_id;
  if v_claim.id is null or v_claim.delivered_sub_ids <> '{}'::uuid[] then
    raise exception '가드: 새 알림이 클레임되지 않거나 delivered_sub_ids 가 비어 있지 않습니다';
  end if;
  select * into v_row from public.notifications where id = v_id;
  if v_row.sent_at is not null or v_row.claimed_at is null then
    raise exception '가드: 클레임이 sent_at 을 찍거나 임대를 기록하지 않았습니다';
  end if;
  select count(*) into v_cnt from public.claim_push_notifications(500) c where c.id = v_id;
  if v_cnt <> 0 then raise exception '가드: 임대 중인 행이 다시 클레임됩니다'; end if;

  -- (d) 전부 실패 → 재시도 예약(1분), 완료 시각 없음 (delivered 생략 = 빈 배열)
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id, 'outcome', 'retry', 'error', 'sent=0 failed=1: 503')));
  select * into v_row from public.notifications where id = v_id;
  if v_row.sent_at is not null or v_row.failed_at is not null or v_row.attempts <> 1
     or v_row.claimed_at is not null or v_row.next_attempt_at is null
     or v_row.next_attempt_at < now() + interval '50 seconds' or v_row.last_error is null then
    raise exception '가드: 실패 정산 결과가 이상합니다 (attempts=%, next=%)', v_row.attempts, v_row.next_attempt_at;
  end if;
  select count(*) into v_cnt from public.claim_push_notifications(500) c where c.id = v_id;
  if v_cnt <> 0 then raise exception '가드: 백오프 중인 행이 클레임됩니다'; end if;

  -- (e) 백오프 도래 → 다시 잡힌다; 임대 만료(5분 경과)도 다시 잡힌다
  update public.notifications set next_attempt_at = now() - interval '1 second' where id = v_id;
  select count(*) into v_cnt from public.claim_push_notifications(500) c where c.id = v_id;
  if v_cnt <> 1 then raise exception '가드: 백오프 도래 행이 클레임되지 않습니다'; end if;
  update public.notifications set claimed_at = now() - interval '6 minutes' where id = v_id;
  select count(*) into v_cnt from public.claim_push_notifications(500) c where c.id = v_id;
  if v_cnt <> 1 then raise exception '가드: 임대 만료 행이 클레임되지 않습니다'; end if;

  -- (f) 2·3번째 실패는 5m·30m, 4번째 실패(한 기기도 못 받음)는 failed_at 종결 — 이후 클레임·sent 정산 불가
  perform public.settle_push_notifications(jsonb_build_array(jsonb_build_object('id', v_id, 'outcome', 'retry', 'error', 'e2', 'delivered', '[]'::jsonb)));
  select * into v_row from public.notifications where id = v_id;
  if v_row.attempts <> 2 or v_row.next_attempt_at < now() + interval '4 minutes' then
    raise exception '가드: 2번째 백오프가 5분이 아닙니다';
  end if;
  perform public.settle_push_notifications(jsonb_build_array(jsonb_build_object('id', v_id, 'outcome', 'retry', 'error', 'e3')));
  select * into v_row from public.notifications where id = v_id;
  if v_row.attempts <> 3 or v_row.next_attempt_at < now() + interval '29 minutes' then
    raise exception '가드: 3번째 백오프가 30분이 아닙니다';
  end if;
  perform public.settle_push_notifications(jsonb_build_array(jsonb_build_object('id', v_id, 'outcome', 'retry', 'error', 'e4')));
  select * into v_row from public.notifications where id = v_id;
  if v_row.attempts <> 4 or v_row.failed_at is null or v_row.sent_at is not null or v_row.next_attempt_at is not null then
    raise exception '가드: 4번째 실패가 종결되지 않습니다';
  end if;
  update public.notifications set claimed_at = null where id = v_id;
  select count(*) into v_cnt from public.claim_push_notifications(500) c where c.id = v_id;
  if v_cnt <> 0 then raise exception '가드: 종결된 행이 클레임됩니다'; end if;
  -- 종결(failed_at)된 행에 늦은 sent 정산이 와도 sent_at 을 찍지 않는다(배타 유지)
  perform public.settle_push_notifications(jsonb_build_array(jsonb_build_object('id', v_id, 'outcome', 'sent', 'error', null)));
  select * into v_row from public.notifications where id = v_id;
  if v_row.sent_at is not null or v_row.failed_at is null then
    raise exception '가드: failed_at 행에 sent 정산이 적용됐습니다(sent_at·failed_at 동시 설정)';
  end if;

  -- (g) 성공 정산은 sent_at 을 찍고 받은 기기·요약을 남긴다; 이후 drop 은 무시된다
  insert into public.notifications (user_id, type_key, title) values (v_uid, 'test', '가드2') returning id into v_id2;
  perform public.claim_push_notifications(500);
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id2, 'outcome', 'sent', 'error', 'sent=1 rejected=1',
                                         'delivered', jsonb_build_array(v_sub1))));
  select * into v_row from public.notifications where id = v_id2;
  if v_row.sent_at is null or v_row.failed_at is not null or v_row.claimed_at is not null
     or v_row.last_error <> 'sent=1 rejected=1' or v_row.delivered_sub_ids <> array[v_sub1] then
    raise exception '가드: 성공 정산 결과가 이상합니다';
  end if;
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id2, 'outcome', 'drop', 'error', 'x')));
  select * into v_row from public.notifications where id = v_id2;
  if v_row.failed_at is not null then
    raise exception '가드: 이미 발송된 행이 drop 으로 덮였습니다';
  end if;

  -- (h) 일부 기기 성공: 재시도로 남되 받은 기기는 delivered_sub_ids 에 누적, 재클레임 시 돌려받는다;
  --     소진(4번째 실패) 시 한 기기라도 받았으면 sent_at(부분 완료)
  insert into public.notifications (user_id, type_key, title) values (v_uid, 'test', '가드3') returning id into v_id3;
  perform public.claim_push_notifications(500);
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id3, 'outcome', 'retry', 'error', 'sent=1 failed=1: web:503',
                                         'delivered', jsonb_build_array(v_sub1))));
  select * into v_row from public.notifications where id = v_id3;
  if v_row.sent_at is not null or v_row.failed_at is not null or v_row.attempts <> 1
     or v_row.delivered_sub_ids <> array[v_sub1] then
    raise exception '가드: 일부 성공 정산이 재시도로 남지 않거나 받은 기기를 기록하지 않습니다';
  end if;
  update public.notifications set next_attempt_at = now() - interval '1 second' where id = v_id3;
  select c.* into v_claim from public.claim_push_notifications(500) c where c.id = v_id3;
  if v_claim.id is null or not (v_claim.delivered_sub_ids @> array[v_sub1]) then
    raise exception '가드: 재클레임이 delivered_sub_ids 를 돌려주지 않습니다';
  end if;
  -- 두 번째 시도에서 다른 기기가 받음(중복 id 포함해도 합집합) → 아직 실패 기기가 남아 재시도
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id3, 'outcome', 'retry', 'error', 'sent=1 failed=1 prior=1',
                                         'delivered', jsonb_build_array(v_sub1, v_sub2))));
  select * into v_row from public.notifications where id = v_id3;
  if v_row.attempts <> 2 or cardinality(v_row.delivered_sub_ids) <> 2
     or not (v_row.delivered_sub_ids @> array[v_sub1, v_sub2]) then
    raise exception '가드: delivered_sub_ids 합집합이 틀립니다 (%)', v_row.delivered_sub_ids;
  end if;
  perform public.settle_push_notifications(jsonb_build_array(jsonb_build_object('id', v_id3, 'outcome', 'retry', 'error', 'e3')));
  perform public.settle_push_notifications(jsonb_build_array(jsonb_build_object('id', v_id3, 'outcome', 'retry', 'error', 'e4')));
  select * into v_row from public.notifications where id = v_id3;
  if v_row.attempts <> 4 or v_row.sent_at is null or v_row.failed_at is not null
     or v_row.next_attempt_at is not null or v_row.claimed_at is not null then
    raise exception '가드: 부분 전달 행의 소진이 sent_at 으로 종결되지 않습니다';
  end if;

  -- (i) 일부 성공 뒤 남은 대상이 사라지면(drop) 실제로 전달된 행이므로 sent_at
  insert into public.notifications (user_id, type_key, title) values (v_uid, 'test', '가드4') returning id into v_id4;
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id4, 'outcome', 'retry', 'error', 'sent=1 failed=1',
                                         'delivered', jsonb_build_array(v_sub2))));
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id4, 'outcome', 'drop', 'error', 'sent=0 pruned=1 prior=1')));
  select * into v_row from public.notifications where id = v_id4;
  if v_row.sent_at is null or v_row.failed_at is not null then
    raise exception '가드: 부분 전달 뒤 drop 이 failed_at 로 종결됐습니다';
  end if;

  -- (j) release: 임대만 풀고 attempts·next_attempt_at 은 그대로 → 즉시 다시 잡힌다
  insert into public.notifications (user_id, type_key, title) values (v_uid, 'test', '가드5') returning id into v_id5;
  perform public.claim_push_notifications(500);
  perform public.settle_push_notifications(
    jsonb_build_array(jsonb_build_object('id', v_id5, 'outcome', 'release', 'error', 'batch_budget')));
  select * into v_row from public.notifications where id = v_id5;
  if v_row.claimed_at is not null or v_row.attempts <> 0 or v_row.next_attempt_at is not null
     or v_row.sent_at is not null or v_row.failed_at is not null or v_row.last_error <> 'batch_budget' then
    raise exception '가드: release 정산 결과가 이상합니다';
  end if;
  select count(*) into v_cnt from public.claim_push_notifications(500) c where c.id = v_id5;
  if v_cnt <> 1 then raise exception '가드: release 된 행이 즉시 클레임되지 않습니다'; end if;

  -- (k) 잘못된 delivered 모양은 거부
  begin
    perform public.settle_push_notifications(
      jsonb_build_array(jsonb_build_object('id', v_id5, 'outcome', 'sent', 'delivered', 'oops')));
    raise exception '가드: delivered 가 배열이 아닌데 정산됐습니다';
  exception
    when raise_exception then
      if sqlerrm not like 'settle_push_notifications: delivered must be an array%' then raise; end if;
  end;

  -- (l) 클라이언트 역할(authenticated + JWT)은 본인 알림의 read_at 만 바꿀 수 있다
  if pg_has_role(current_user, 'authenticated', 'member') then
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.notifications set read_at = now() where id = v_id2;
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 then
      reset role;
      raise notice '가드: JWT 시뮬레이션으로 본인 행이 보이지 않아 트리거 검증을 건너뜁니다(row_count=%)', v_cnt;
    else
      begin
        update public.notifications set sent_at = null, attempts = 0 where id = v_id2;
        raise exception '가드: 클라이언트가 큐 컬럼(sent_at·attempts)을 바꿀 수 있습니다';
      exception
        when insufficient_privilege then null;
      end;
      begin
        -- now() 는 트랜잭션 내내 같은 값이라(행도 이 트랜잭션에서 삽입) 반드시 다른 값으로 바꿔야 변경이 된다
        update public.notifications set created_at = now() + interval '1 hour' where id = v_id2;
        raise exception '가드: 클라이언트가 created_at 을 바꿀 수 있습니다';
      exception
        when insufficient_privilege then null;
      end;
      reset role;
    end if;
    perform set_config('request.jwt.claims', '', true);
  else
    raise notice '가드: 현재 역할이 authenticated 멤버가 아니라 트리거 검증을 건너뜁니다';
  end if;
  -- 신뢰 경계 안(현재 역할)의 큐 컬럼 갱신은 트리거가 막지 않는다
  update public.notifications set sent_at = null where id = v_id2;
  select * into v_row from public.notifications where id = v_id2;
  if v_row.sent_at is not null then raise exception '가드: 내부 역할의 큐 컬럼 갱신이 막혔습니다'; end if;

  -- (m) 권한: anon·authenticated 는 두 큐 함수를 실행할 수 없다; 트리거는 걸려 있다
  if has_function_privilege('anon', 'public.claim_push_notifications(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_push_notifications(integer)', 'execute')
     or has_function_privilege('anon', 'public.settle_push_notifications(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_push_notifications(jsonb)', 'execute') then
    raise exception '가드: 큐 함수가 클라이언트에 노출됐습니다';
  end if;
  if not has_function_privilege('authenticated', 'public.is_push_endpoint_allowed(text)', 'execute') then
    raise exception '가드: endpoint 검사 함수에 authenticated EXECUTE 가 없습니다(구독 저장이 죽습니다)';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.notifications'::regclass
       and tgname = 'notifications_client_update_guard_trg' and not tgisinternal
  ) then
    raise exception '가드: 클라이언트 갱신 제한 트리거가 없습니다';
  end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
