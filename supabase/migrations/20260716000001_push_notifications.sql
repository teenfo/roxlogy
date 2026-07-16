-- 푸시 알림 인프라 (Phase 1): 종류 카탈로그 · 구독 · 종류별 선호 · 알림 아웃박스.
-- 종류-무관 발송 파이프라인의 데이터 모델. 전 테이블 RLS. 새 알림 종류 = notification_types 행 1개.

-- 1) 종류 카탈로그 (확장 지점) --------------------------------------------------
create table if not exists public.notification_types (
  key             text primary key,
  description     text not null,
  default_enabled boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.notification_types enable row level security;
-- 로그인 사용자는 읽기 가능(설정 화면). 쓰기는 서버(service role)만.
drop policy if exists "ntypes_read" on public.notification_types;
create policy "ntypes_read" on public.notification_types
  for select using (auth.role() = 'authenticated');

insert into public.notification_types(key, description, default_enabled) values
  ('wod_reminder', '오늘의 WOD 리마인더', true),
  ('new_follower', '새 팔로워 알림', true)
on conflict (key) do nothing;

-- 2) 푸시 구독 (웹 Web Push / 안드로이드 FCM) — 본인 것만 -----------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text not null check (platform in ('web','android')),
  endpoint   text,          -- web push
  p256dh     text,          -- web push
  auth       text,          -- web push
  fcm_token  text,          -- android
  ua         text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  disabled   boolean not null default false,
  unique (user_id, endpoint),
  unique (user_id, fcm_token)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "subs_select_own" on public.push_subscriptions;
drop policy if exists "subs_insert_own" on public.push_subscriptions;
drop policy if exists "subs_update_own" on public.push_subscriptions;
drop policy if exists "subs_delete_own" on public.push_subscriptions;
create policy "subs_select_own" on public.push_subscriptions for select using (user_id = auth.uid());
create policy "subs_insert_own" on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy "subs_update_own" on public.push_subscriptions for update using (user_id = auth.uid());
create policy "subs_delete_own" on public.push_subscriptions for delete using (user_id = auth.uid());
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- 3) 종류별 선호(옵트인/아웃) — 없으면 default_enabled 적용 ---------------------
create table if not exists public.notification_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  type_key   text not null references public.notification_types(key) on delete cascade,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, type_key)
);
alter table public.notification_prefs enable row level security;
drop policy if exists "prefs_select_own" on public.notification_prefs;
drop policy if exists "prefs_insert_own" on public.notification_prefs;
drop policy if exists "prefs_update_own" on public.notification_prefs;
drop policy if exists "prefs_delete_own" on public.notification_prefs;
create policy "prefs_select_own" on public.notification_prefs for select using (user_id = auth.uid());
create policy "prefs_insert_own" on public.notification_prefs for insert with check (user_id = auth.uid());
create policy "prefs_update_own" on public.notification_prefs for update using (user_id = auth.uid());
create policy "prefs_delete_own" on public.notification_prefs for delete using (user_id = auth.uid());

-- 4) 알림 아웃박스(인앱 알림함 겸용) — 발송은 서버가 insert -------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type_key   text not null,
  title      text not null,
  body       text,
  url        text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  read_at    timestamptz
);
alter table public.notifications enable row level security;
drop policy if exists "notif_select_own" on public.notifications;
drop policy if exists "notif_update_own" on public.notifications;
create policy "notif_select_own" on public.notifications for select using (user_id = auth.uid());
create policy "notif_update_own" on public.notifications for update using (user_id = auth.uid()); -- read_at 갱신
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);

-- 5) WOD 리마인더용 사용자 설정 (시각은 사용자 입력, null=끔) -------------------
alter table public.profiles
  add column if not exists timezone text,
  add column if not exists wod_reminder_time time;
