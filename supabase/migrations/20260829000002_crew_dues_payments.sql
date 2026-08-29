-- ============================================================
-- Roxlogy — 크루 회비 납부 체크 장부 (월 × 멤버)
--
-- 흐름(셀프 신고 + 운영진 확인):
--   1) 멤버가 납부 후 "납부 완료 신고" → status='reported' (확인 대기)
--   2) 운영진이 입금 대조 후 확정 → set_dues_paid RPC (status='confirmed')
--      금액을 넣으면 회계(crew_ledger)에 수입이 자동 기록된다.
--   운영진은 신고 없이도 바로 납부 체크(확정)할 수 있다.
-- 조회: 본인 것 + 운영진은 크루 전체. 해제는 행 삭제(회계 기록은 유지).
-- ============================================================

create table if not exists public.crew_dues_payments (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  status text not null default 'reported'
    check (status in ('reported', 'confirmed')),
  amount int check (amount is null or amount > 0),
  reported_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  unique (crew_id, user_id, period)
);

create index if not exists crew_dues_payments_crew_period_idx
  on public.crew_dues_payments(crew_id, period);

alter table public.crew_dues_payments enable row level security;

-- 조회: 본인 행 + 운영진·관리자는 크루 전체
create policy crew_dues_payments_select on public.crew_dues_payments
  for select using (
    user_id = auth.uid() or is_crew_staff(crew_id) or is_admin()
  );

-- 셀프 신고: 크루원이 본인 몫을 '확인 대기'로만 등록 (확정은 RPC 전용)
create policy crew_dues_payments_insert on public.crew_dues_payments
  for insert with check (
    (user_id = auth.uid() and is_crew_member(crew_id) and status = 'reported')
    or is_crew_staff(crew_id) or is_admin()
  );

-- 수정: 운영진·관리자만 (확정은 보통 set_dues_paid RPC 경유)
create policy crew_dues_payments_update on public.crew_dues_payments
  for update using (is_crew_staff(crew_id) or is_admin());

-- 삭제: 본인 신고 취소(확정 전) + 운영진 체크 해제
create policy crew_dues_payments_delete on public.crew_dues_payments
  for delete using (
    (user_id = auth.uid() and status = 'reported')
    or is_crew_staff(crew_id) or is_admin()
  );

-- 납부 확정 — 운영진 전용. 신고가 있으면 확정으로 올리고, 없으면 바로 확정 행을
-- 만든다(멱등). 금액이 오면 회계에 수입을 자동 기록한다.
create or replace function public.set_dues_paid(
  p_crew uuid, p_user uuid, p_period text, p_amount int default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_status text;
  v_name text;
begin
  if not (is_admin() or is_crew_staff(p_crew)) then
    raise exception '운영진만 납부를 확정할 수 있습니다';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    raise exception '기간은 YYYY-MM 형식이어야 합니다';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception '금액은 0보다 커야 합니다';
  end if;

  select status into v_status from crew_dues_payments
  where crew_id = p_crew and user_id = p_user and period = p_period;
  if v_status = 'confirmed' then
    return; -- 이미 확정 — 중복 회계 기록 방지
  end if;

  insert into crew_dues_payments
    (crew_id, user_id, period, status, amount, confirmed_at, confirmed_by)
  values (p_crew, p_user, p_period, 'confirmed', p_amount, now(), auth.uid())
  on conflict (crew_id, user_id, period) do update
    set status = 'confirmed',
        amount = coalesce(excluded.amount, crew_dues_payments.amount),
        confirmed_at = now(),
        confirmed_by = auth.uid();

  if p_amount is not null then
    select display_name into v_name from profiles where id = p_user;
    insert into crew_ledger (crew_id, entry_date, kind, amount, title, created_by)
    values (
      p_crew, current_date, 'income', p_amount,
      p_period || ' 회비 — ' || coalesce(v_name, '멤버'), auth.uid()
    );
  end if;
end;
$$;

grant execute on function public.set_dues_paid(uuid, uuid, text, int) to authenticated;
