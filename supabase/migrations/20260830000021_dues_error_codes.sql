-- ============================================================
-- Roxlogy — 시스템 감사 수리 (9) 회비 예외 코드화 · 자동 장부 출처
--
-- set_dues_paid 가 한국어 예외 문장을 던져 en/es UI 에 그대로 노출됐고,
-- 자동 생성 장부 제목도 한국어로 영구 저장됐다. 예외는 안정적인 코드로
-- 던지고(클라이언트가 사전으로 번역), 장부 행은 source='dues' 로 표시해
-- 표시 문구를 화면이 조립하게 한다.
-- ============================================================

alter table public.crew_ledger
  add column if not exists source text
    check (source is null or source in ('dues'));

update public.crew_ledger
set source = 'dues',
    title = regexp_replace(title, '^(\d{4}-\d{2})\s*회비\s*—\s*', '\1 · ')
where source is null and title ~ '^\d{4}-\d{2}\s*회비\s*—\s*';

create or replace function public.set_dues_paid(
  p_crew uuid, p_user uuid, p_period text, p_amount int default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_status text;
  v_name text;
begin
  if not (is_admin() or is_crew_staff(p_crew)) then
    raise exception 'dues_not_staff' using errcode = 'P0001';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'dues_bad_period' using errcode = 'P0001';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'dues_bad_amount' using errcode = 'P0001';
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
    insert into crew_ledger (crew_id, entry_date, kind, amount, title, created_by, source)
    values (
      p_crew, app_today(), 'income', p_amount,
      p_period || ' · ' || coalesce(nullif(v_name, ''), '—'), auth.uid(), 'dues'
    );
  end if;
end;
$$;
grant execute on function public.set_dues_paid(uuid, uuid, text, int) to authenticated;
