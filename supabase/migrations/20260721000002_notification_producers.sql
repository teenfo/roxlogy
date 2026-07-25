-- 알림 프로듀서 (Phase 2/3): 새 팔로워 트리거 + WOD 리마인더 크론 + 디스패치.
-- 설계: 프로듀서는 HTTP 없이 notifications(아웃박스)에 행만 삽입(옵트아웃은 삽입 시점에 SQL로 존중).
-- 실제 발송은 Edge Function `push-dispatch`가 미발송 행을 클레임해 팬아웃(web-push/FCM).
-- pg_cron이 1분마다 pg_net으로 push-dispatch를 호출(anon 키 = 공개 JWT, 게이트웨이 verify_jwt 통과용).
-- service role 키는 SQL/크론에 절대 넣지 않는다 — 디스패치는 멱등(원자적 클레임)이라 조기/중복 호출 무해.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 0) FCM 토큰은 "기기" 식별자지 "사용자" 식별자가 아니다. 같은 토큰이 다른 계정에
--    남아 있으면(공유 기기에서 로그아웃 없이 계정 전환 등) 이전 사용자 알림이 새 사용자
--    기기로 새는 개인정보 문제 → 등록 시 다른 계정의 동일 토큰 행을 정리하는 RPC.
create or replace function public.register_fcm_token(p_token text, p_ua text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_token is null or length(p_token) < 10 or length(p_token) > 4096 then
    raise exception 'invalid token';
  end if;
  -- 같은 기기 토큰을 물고 있는 다른 계정 행 제거 (기기 소유권 이전)
  delete from public.push_subscriptions
    where fcm_token = p_token and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, platform, fcm_token, ua, disabled, last_seen)
    values (auth.uid(), 'android', p_token, p_ua, false, now())
  on conflict (user_id, fcm_token) do update
    set ua = excluded.ua, disabled = false, last_seen = now();
end;
$$;
revoke all on function public.register_fcm_token(text, text) from public;
grant execute on function public.register_fcm_token(text, text) to authenticated;

-- 1) 알림 인큐 공통 함수 — 옵트아웃(notification_prefs → default_enabled) 존중해 아웃박스 삽입.
create or replace function public.enqueue_notification(
  p_user_id uuid, p_type_key text, p_title text, p_body text, p_url text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select coalesce(
    (select np.enabled from public.notification_prefs np
      where np.user_id = p_user_id and np.type_key = p_type_key),
    (select nt.default_enabled from public.notification_types nt where nt.key = p_type_key),
    false)  -- 등록 안 된 종류는 발송하지 않음
  into v_enabled;
  if not v_enabled then return; end if;
  insert into public.notifications (user_id, type_key, title, body, url)
    values (p_user_id, p_type_key, left(p_title, 120), left(p_body, 1000), left(p_url, 500));
end;
$$;
revoke all on function public.enqueue_notification(uuid, text, text, text, text) from public;

-- 2) 새 팔로워: follows AFTER INSERT → 팔로우당한 사용자에게 알림 인큐.
create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select coalesce(nullif(display_name, ''), '누군가') into v_name
    from public.profiles where id = new.follower_id;
  perform public.enqueue_notification(
    new.followee_id, 'new_follower',
    '새 팔로워',
    v_name || '님이 회원님을 팔로우하기 시작했습니다.',
    '/u/' || new.follower_id::text);
  return new;
end;
$$;

drop trigger if exists trg_notify_new_follower on public.follows;
create trigger trg_notify_new_follower
  after insert on public.follows
  for each row execute function public.notify_new_follower();

-- 3) WOD 리마인더: 5분마다 스캔 — 사용자 지역시각이 설정 시각 창(5분)에 들면 하루 1회 인큐.
create or replace function public.enqueue_wod_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select p.id, p.timezone, p.wod_reminder_time,
           (now() at time zone coalesce(p.timezone, 'UTC')) as local_now
    from public.profiles p
    where p.wod_reminder_time is not null
  loop
    -- 자정 넘김 안전: 초 차이를 mod 86400으로 정규화해 [0, 300초) 창 판정
    if mod(cast(extract(epoch from (r.local_now::time - r.wod_reminder_time)) as integer) + 86400, 86400) < 300 then
      -- 같은 지역 날짜에 이미 보냈으면 스킵
      if not exists (
        select 1 from public.notifications n
        where n.user_id = r.id and n.type_key = 'wod_reminder'
          and (n.created_at at time zone coalesce(r.timezone, 'UTC'))::date = r.local_now::date
      ) then
        perform public.enqueue_notification(
          r.id, 'wod_reminder',
          '오늘의 WOD',
          '오늘의 워크아웃을 확인하고 기록해 보세요.',
          '/dashboard');
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.enqueue_wod_reminders() from public;

-- 4) 크론 등록 (멱등: 있으면 재등록)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'roxlogy-wod-reminders') then
    perform cron.unschedule('roxlogy-wod-reminders');
  end if;
  if exists (select 1 from cron.job where jobname = 'roxlogy-push-dispatch') then
    perform cron.unschedule('roxlogy-push-dispatch');
  end if;
end $$;

select cron.schedule(
  'roxlogy-wod-reminders', '*/5 * * * *',
  $$select public.enqueue_wod_reminders()$$
);

-- 디스패치: 1분마다 push-dispatch 호출. Authorization의 anon 키는 **공개 키**(웹 번들에 이미 포함,
-- RLS로 보호)라 SQL 포함이 안전하다. service role 키는 여기 절대 금지 — 발송 권한은
-- push-dispatch 내부의 env(SERVICE_ROLE)로만 행사된다.
select cron.schedule(
  'roxlogy-push-dispatch', '* * * * *',
  $$
  select net.http_post(
    url := 'https://vuloxbpfhyqkvgmpmkst.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bG94YnBmaHlxa3ZnbXBta3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTc0NzgsImV4cCI6MjA5ODc5MzQ3OH0.WhmfRIZWBS88_Rf-e_p7tMpOLKEX9kKxC67KVrLZGjs'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  $$
);
