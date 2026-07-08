-- ============================================================
-- 006 — 목표 계획 저장 (S14/S17)
-- /predict 목표 스플릿을 로그인 사용자가 저장하고, 리허설 리포트(S17)에서
-- 실측 세션과 대비한다. 본인만 read/write (RLS).
-- ============================================================

create table public.goal_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  target_total_ms   bigint not null,
  level             text not null check (level in ('beginner','intermediate','advanced')),
  run_total_ms      bigint,
  station_total_ms  bigint,
  roxzone_total_ms  bigint,
  stations          jsonb,           -- [{key, targetMs}, ...] (스테이션별 목표)
  created_at        timestamptz not null default now()
);

create index idx_goal_plans_user
  on public.goal_plans(user_id, created_at desc);

alter table public.goal_plans enable row level security;

create policy "goal_plans_select_own" on public.goal_plans
  for select using (user_id = auth.uid());
create policy "goal_plans_insert_own" on public.goal_plans
  for insert with check (user_id = auth.uid());
create policy "goal_plans_delete_own" on public.goal_plans
  for delete using (user_id = auth.uid());
