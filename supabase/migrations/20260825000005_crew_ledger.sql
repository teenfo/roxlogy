-- ============================================================
-- Roxlogy — 크루 회계 장부
--
-- 수입/지출 내역과 월 합계를 크루원에게 보여주는 단순 장부.
-- 조회 = 크루 멤버(재정은 비공개 크루 정보), 기록/수정/삭제 = 스태프.
-- 금액은 KRW 정수(원 단위).
-- ============================================================

create table if not exists public.crew_ledger (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  entry_date date not null default current_date,
  kind text not null check (kind in ('income', 'expense')),
  amount integer not null check (amount > 0),
  title text not null check (char_length(title) between 1 and 120),
  memo text check (char_length(memo) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crew_ledger_crew_date
  on public.crew_ledger (crew_id, entry_date desc);

alter table public.crew_ledger enable row level security;

create policy crew_ledger_select on public.crew_ledger
  for select using (is_crew_member(crew_id) or is_admin());

create policy crew_ledger_insert on public.crew_ledger
  for insert with check (is_crew_staff(crew_id) and created_by = auth.uid());

create policy crew_ledger_update on public.crew_ledger
  for update using (is_crew_staff(crew_id));

create policy crew_ledger_delete on public.crew_ledger
  for delete using (is_crew_staff(crew_id) or is_admin());
