-- ============================================================
-- HYROX Training App — 001 초기 스키마
-- 테이블 + 인덱스 + updated_at 트리거
-- (RLS 정책은 002 마이그레이션에서 분리 적용)
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- updated_at 자동 갱신 함수 (LWW 충돌 정책 지원)
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1. 사용자 프로필 (auth.users 확장)
-- ------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  division      text check (division in ('open','pro','doubles','pro_doubles','relay')),
  gender        text,
  height_cm     numeric,
  weight_kg     numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 신규 auth.users 가입 시 profiles 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', null));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. 운동 마스터 DB (360+, 한/영) — 공용 읽기
-- ------------------------------------------------------------
create table public.exercises (
  id             uuid primary key default uuid_generate_v4(),
  name_ko        text not null,
  name_en        text not null,
  category       text,                         -- strength / running / conditioning / mobility
  equipment      text[],                       -- ['sled','kettlebell',...]
  station_type   text,                         -- hyrox 스테이션 매핑 (nullable)
  media_url      text,
  description_ko text,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. 프로그램 / 일자 / 세션 템플릿
-- ------------------------------------------------------------
create table public.programs (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid references public.profiles(id) on delete cascade, -- null이면 공용
  title       text not null,
  description text,
  weeks       int,
  level       text check (level in ('beginner','intermediate','advanced','elite')),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.program_days (
  id          uuid primary key default uuid_generate_v4(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  day_index   int not null,
  focus       text,
  notes       text
);

create table public.workout_templates (
  id             uuid primary key default uuid_generate_v4(),
  program_day_id uuid references public.program_days(id) on delete cascade,
  title          text not null,
  type           text not null check (type in ('race_sim','wod','run','strength')),
  structure      jsonb not null,
  created_at     timestamptz not null default now()
);

create table public.workout_template_items (
  id           uuid primary key default uuid_generate_v4(),
  template_id  uuid not null references public.workout_templates(id) on delete cascade,
  seq          int not null,
  exercise_id  uuid references public.exercises(id),
  target       jsonb
);

-- ------------------------------------------------------------
-- 4. 세션 (실제 수행 기록) — id는 클라이언트(워치) 생성 UUID
-- ------------------------------------------------------------
create table public.sessions (
  id             uuid primary key,            -- 클라이언트 생성 UUID (멱등 업서트 키)
  user_id        uuid not null references public.profiles(id) on delete cascade,
  template_id    uuid references public.workout_templates(id),
  source_device  text not null check (source_device in ('watch','phone','web')),
  sync_status    text not null default 'synced' check (sync_status in ('local','pending','synced')),
  analysis_status text not null default 'pending' check (analysis_status in ('pending','processing','done','failed')),
  started_at     timestamptz not null,
  ended_at       timestamptz,
  total_time_ms  bigint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_sessions_updated
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. 세션 세그먼트 (런 / 스테이션 / ROXZONE)
-- ------------------------------------------------------------
create table public.session_segments (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  seq           int not null,
  kind          text not null check (kind in ('run','station','roxzone')),
  exercise_id   uuid references public.exercises(id),
  machine_type  text check (machine_type in ('ski','row')),
  split_time_ms bigint,
  started_at    timestamptz,
  ended_at      timestamptz
);

-- ------------------------------------------------------------
-- 6. erg raw 시계열 (원본 보존, JSONB 배열)
-- ------------------------------------------------------------
create table public.erg_samples (
  id            uuid primary key default uuid_generate_v4(),
  segment_id    uuid not null references public.session_segments(id) on delete cascade,
  machine_type  text not null check (machine_type in ('ski','row')),
  samples       jsonb not null,               -- [{t,dist,pace,spm,watts,cal,drive_len,...}, ...]
  sample_count  int not null default 0,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. 파생 지표 (hosub 워커가 계산해 채움)
-- ------------------------------------------------------------
create table public.segment_metrics (
  segment_id    uuid primary key references public.session_segments(id) on delete cascade,
  avg_power     numeric,
  max_power     numeric,
  avg_spm       numeric,
  avg_pace_500  numeric,
  pace_curve    jsonb,
  power_curve   jsonb,
  computed_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. 실측 레이스 기록
-- ------------------------------------------------------------
create table public.race_results (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  event         text,
  event_date    date,
  division      text,
  total_time_ms bigint,
  splits        jsonb,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 인덱스
-- ------------------------------------------------------------
create index idx_sessions_user        on public.sessions(user_id, started_at desc);
create index idx_sessions_analysis    on public.sessions(analysis_status) where analysis_status = 'pending';
create index idx_segments_session     on public.session_segments(session_id, seq);
create index idx_ergsamples_segment   on public.erg_samples(segment_id);
create index idx_metrics_computed     on public.segment_metrics(computed_at);
create index idx_raceresults_user     on public.race_results(user_id, event_date desc);
create index idx_programdays_program  on public.program_days(program_id, day_index);
create index idx_templateitems_tmpl   on public.workout_template_items(template_id, seq);
