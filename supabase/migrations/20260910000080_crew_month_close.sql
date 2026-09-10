-- ============================================================
-- Roxlogy — 크루 회계 월 마감
--
-- 그 달의 회비 청구·장부를 확정하고 잠근다. 마감하면 청구 상태(확정·면제·
-- 신고·대사)와 장부 내역(추가·수정·삭제)이 모두 막힌다.
--
-- 딱 하나 예외: 마감된 달 내역의 **통장 반영일(settled_on)**. 9월 장부를 닫은
-- 뒤에 9월 지출이 10월 통장에 찍히는 일이 흔해서, 이것까지 막으면 대사를 할 수
-- 없다. 금액·날짜·제목·수단은 잠긴다.
--
-- 마감은 운영진이 언제든 해제할 수 있다(잠금이지 봉인이 아니다).
-- ============================================================

create table if not exists public.crew_month_close (
  crew_id uuid not null references public.crews(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id) on delete set null,
  primary key (crew_id, period)
);

alter table public.crew_month_close enable row level security;

-- 조회는 크루 멤버 — 일반 회원도 "이 달은 마감됐다"를 봐야 한다
create policy crew_month_close_select on public.crew_month_close
  for select using ((select is_crew_member(crew_id)) or (select is_admin()));

create policy crew_month_close_insert on public.crew_month_close
  for insert with check ((select is_crew_staff(crew_id)) and closed_by = auth.uid());

create policy crew_month_close_delete on public.crew_month_close
  for delete using ((select is_crew_staff(crew_id)) or (select is_admin()));

-- update 정책은 두지 않는다 — 마감은 켜고 끄는 것뿐이다

-- ---------- 잠금 판정 ----------------------------------------------------
-- 트리거에서 부르므로 definer. 클라이언트는 테이블을 직접 읽으면 되니 grant 없음.
create or replace function public.is_month_closed(p_crew uuid, p_period text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.crew_month_close
     where crew_id = p_crew and period = p_period
  );
$$;

-- ---------- 장부 잠금 ----------------------------------------------------
create or replace function public.rox_ledger_month_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    if is_month_closed(old.crew_id, to_char(old.entry_date, 'YYYY-MM'))
       or is_month_closed(new.crew_id, to_char(new.entry_date, 'YYYY-MM')) then
      -- settled_on 만 바뀌는 수정은 통과시킨다 (통장 대사)
      if (new.crew_id, new.entry_date, new.kind, new.amount,
          new.title, new.memo, new.source, new.method)
         is distinct from
         (old.crew_id, old.entry_date, old.kind, old.amount,
          old.title, old.memo, old.source, old.method) then
        raise exception 'ledger_month_closed';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if is_month_closed(old.crew_id, to_char(old.entry_date, 'YYYY-MM')) then
      raise exception 'ledger_month_closed';
    end if;
    return old;
  end if;

  if is_month_closed(new.crew_id, to_char(new.entry_date, 'YYYY-MM')) then
    raise exception 'ledger_month_closed';
  end if;
  return new;
end $$;

drop trigger if exists rox_ledger_month_guard_trg on public.crew_ledger;
create trigger rox_ledger_month_guard_trg
  before insert or update or delete on public.crew_ledger
  for each row execute function public.rox_ledger_month_guard();

-- ---------- 회비 청구 잠금 ------------------------------------------------
create or replace function public.rox_dues_month_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op <> 'INSERT'
     and is_month_closed(old.crew_id, old.period) then
    raise exception 'dues_month_closed';
  end if;
  if tg_op <> 'DELETE'
     and is_month_closed(new.crew_id, new.period) then
    raise exception 'dues_month_closed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists rox_dues_month_guard_trg on public.crew_dues_charges;
create trigger rox_dues_month_guard_trg
  before insert or update or delete on public.crew_dues_charges
  for each row execute function public.rox_dues_month_guard();

-- ---------- 가드 ----------------------------------------------------------
do $$
declare v_crew uuid; v_id uuid; v_ok boolean;
begin
  select id into v_crew from public.crews limit 1;
  if v_crew is null then return; end if;

  -- (a) 마감된 달에는 내역이 들어가지 않는다
  insert into public.crew_month_close (crew_id, period) values (v_crew, '2099-01');
  v_ok := false;
  begin
    insert into public.crew_ledger (crew_id, entry_date, kind, amount, title)
    values (v_crew, '2099-01-15', 'income', 1000, '가드');
  exception when others then
    if sqlerrm like '%ledger_month_closed%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception '가드: 마감된 달에 내역이 추가됐습니다'; end if;

  -- (b) 마감 전에 넣은 내역은 금액이 잠기고, 통장 반영일만 열려 있다
  insert into public.crew_ledger (crew_id, entry_date, kind, amount, title)
  values (v_crew, '2098-01-15', 'expense', 1000, '가드2')
  returning id into v_id;
  insert into public.crew_month_close (crew_id, period) values (v_crew, '2098-01');

  update public.crew_ledger set settled_on = '2098-02-03' where id = v_id;

  v_ok := false;
  begin
    update public.crew_ledger set amount = 2000 where id = v_id;
  exception when others then
    if sqlerrm like '%ledger_month_closed%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception '가드: 마감된 달의 금액이 바뀌었습니다'; end if;

  v_ok := false;
  begin
    delete from public.crew_ledger where id = v_id;
  exception when others then
    if sqlerrm like '%ledger_month_closed%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception '가드: 마감된 달의 내역이 삭제됐습니다'; end if;

  -- (c) 마감을 풀면 다시 열린다
  delete from public.crew_month_close where crew_id = v_crew and period = '2098-01';
  update public.crew_ledger set amount = 2000 where id = v_id;
  delete from public.crew_ledger where id = v_id;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
