-- ============================================================
-- Roxlogy — 011 프로그램 등록/일정 (오늘의 운동)
--
-- 사용자가 프로그램을 "시작일"에 배치하면, program_days.day_index(1-based
-- 순차 일자)를 달력 날짜에 매핑해 "오늘의 운동"을 계산한다.
-- 사용자당 활성 등록은 1건(부분 유니크). 본인 데이터 — own RLS.
-- ============================================================

create table public.program_enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  program_id  uuid not null references public.programs(id) on delete cascade,
  start_date  date not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 활성 등록은 사용자당 최대 1건
create unique index uq_active_enrollment
  on public.program_enrollments (user_id)
  where active;

create index idx_enrollment_user on public.program_enrollments (user_id, active);

alter table public.program_enrollments enable row level security;

create policy "enroll_select_own" on public.program_enrollments
  for select using (user_id = auth.uid());
create policy "enroll_insert_own" on public.program_enrollments
  for insert with check (user_id = auth.uid());
create policy "enroll_update_own" on public.program_enrollments
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "enroll_delete_own" on public.program_enrollments
  for delete using (user_id = auth.uid());
