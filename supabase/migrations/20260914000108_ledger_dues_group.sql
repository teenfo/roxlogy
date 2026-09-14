-- ============================================================
-- Roxlogy — 회비 입금을 묶어 보기 위한 장부 회차 표시
--
-- 회계 시안의 "회비 입금 묶어 보기" 체크박스. 21명 월회비를 한 번에 확정하면
-- 장부에 21줄이 생기는데, 장부를 읽는 사람에게 그건 거래 21건이 아니라
-- "9월 월회비 21명"한 건이다.
--
-- 묶으려면 장부 행이 "어느 회차의 회비인가"를 알아야 한다. 지금은 청구가
-- 장부를 가리키는 단방향(crew_dues_charges.ledger_id)뿐이라 장부 쪽에서는
-- 셀 수 없고, 청구 테이블은 RLS 가 본인 것과 운영진에게만 열려 있어서
-- 일반 정회원 화면에서는 조인으로도 못 센다. 그래서 장부 행에 회차 키를 적는다.
--
--   monthly:<YYYY-MM>   월회비 일괄 확정
--   session:<event_id>  모임 출석 회차비
--   custom:<charge_id>  임의 청구 (한 건이므로 늘 혼자)
--
-- 묶는 건 화면이 한다 — 같은 키끼리 한 줄로 접고, 체크를 끄면 원래 행이 보인다.
-- 합계·잔액은 어느 쪽이든 같은 행들에서 나오므로 숫자가 달라지지 않는다.
-- ============================================================

alter table public.crew_ledger
  add column if not exists dues_group text;

comment on column public.crew_ledger.dues_group is
  '회비 확정으로 생긴 행의 회차 키. monthly:<YYYY-MM> / session:<event_id> / custom:<charge_id>. 손으로 적은 거래는 null.';

-- 같은 회차를 모으는 조회만 한다 — 크루·월 범위는 기존 (crew_id, entry_date desc)
-- 인덱스가 이미 좁혀 주므로 새 인덱스는 만들지 않는다.

-- ---------- 확정 시 회차 키를 적는다 --------------------------------------
-- 79 의 정의에 dues_group 만 더한다(나머지 동작은 그대로).
create or replace function public.confirm_dues_charge(p_charge uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record; v_name text; v_ledger uuid;
begin
  select * into c from crew_dues_charges where id = p_charge;
  if c is null then raise exception 'charge_not_found'; end if;
  if not ((select is_crew_staff(c.crew_id)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  if c.status = 'confirmed' then return; end if;
  -- 면제된 건을 그대로 확정하면 받지 않은 돈이 수입으로 잡힌다
  if c.status = 'waived' then raise exception 'dues_waived'; end if;

  select display_name into v_name from profiles where id = c.user_id;
  insert into crew_ledger (crew_id, entry_date, kind, amount, title, source, dues_group, created_by)
  values (c.crew_id, app_today(), 'income', c.amount,
          left(c.label || ' — ' || coalesce(v_name, '멤버'), 120), 'dues',
          case c.kind
            when 'monthly' then 'monthly:' || c.period
            when 'session' then 'session:' || c.event_id::text
            else 'custom:' || c.id::text
          end,
          auth.uid())
  returning id into v_ledger;

  update crew_dues_charges
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(),
         ledger_id = v_ledger
   where id = p_charge;
end;
$$;

-- ---------- 이미 확정된 건 소급 ------------------------------------------
update public.crew_ledger l
   set dues_group = case ch.kind
         when 'monthly' then 'monthly:' || ch.period
         when 'session' then 'session:' || ch.event_id::text
         else 'custom:' || ch.id::text
       end
  from public.crew_dues_charges ch
 where ch.ledger_id = l.id
   and l.dues_group is null;

-- ---------- 마감 잠금에 dues_group 포함 -----------------------------------
-- 106 과 같은 이유: 이 판정은 컬럼을 손으로 나열한 튜플 비교라, 새 컬럼을 적어
-- 주지 않으면 마감된 달에도 조용히 바뀐다.
create or replace function public.rox_ledger_month_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    if is_month_closed(old.crew_id, to_char(old.entry_date, 'YYYY-MM'))
       or is_month_closed(new.crew_id, to_char(new.entry_date, 'YYYY-MM')) then
      if (new.crew_id, new.entry_date, new.kind, new.amount, new.title,
          new.memo, new.source, new.method, new.category, new.dues_group)
         is distinct from
         (old.crew_id, old.entry_date, old.kind, old.amount, old.title,
          old.memo, old.source, old.method, old.category, old.dues_group) then
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

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_n int;
  v_crew uuid;
  v_staff uuid;
  v_member uuid;
  v_c1 uuid;
  v_c2 uuid;
  v_groups int;
  v_rows int;
  v_started timestamptz := now();
begin
  -- 1) 확정된 청구가 가리키는 장부 행에 회차 키가 비면 안 된다 (소급 검사)
  select count(*) into v_n
    from crew_dues_charges ch
    join crew_ledger l on l.id = ch.ledger_id
   where l.dues_group is null;
  if v_n > 0 then raise exception '가드: 회차 키가 빈 회비 장부 행 %건', v_n; end if;

  -- 2) 월회비 두 건을 확정하면 장부 두 줄이 같은 키로 묶인다
  select c.id into v_crew from crews c
   join crew_members m on m.crew_id = c.id and m.role in ('owner','coach') and m.status = 'active'
   where not is_month_closed(c.id, to_char(app_today(), 'YYYY-MM'))
   limit 1;
  if v_crew is null then
    raise notice '가드: 쓸 수 있는 크루가 없어 묶음 검사를 건너뛴다';
    return;
  end if;
  select user_id into v_staff from crew_members
   where crew_id = v_crew and role in ('owner','coach') and status = 'active' limit 1;
  select user_id into v_member from crew_members
   where crew_id = v_crew and status = 'active' and user_id <> v_staff limit 1;
  if v_member is null then v_member := v_staff; end if;

  insert into crew_dues_charges (crew_id, user_id, kind, label, amount, period, status)
  values (v_crew, v_staff, 'monthly', '__guard__ 월회비', 1000, '2099-01', 'pending')
  returning id into v_c1;
  insert into crew_dues_charges (crew_id, user_id, kind, label, amount, period, status)
  values (v_crew, v_member, 'monthly', '__guard__ 월회비', 1000, '2099-01', 'pending')
  returning id into v_c2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform confirm_dues_charge(v_c1);
  if v_c2 <> v_c1 then perform confirm_dues_charge(v_c2); end if;
  perform set_config('request.jwt.claims', null, true);

  select count(*), count(distinct dues_group) into v_rows, v_groups
    from crew_ledger
   where crew_id = v_crew and created_at >= v_started and source = 'dues';
  if v_rows < 1 then raise exception '가드: 확정했는데 장부 행이 없다'; end if;
  if v_groups <> 1 then
    raise exception '가드: 같은 달 월회비가 한 키로 묶이지 않았다 (행 % / 키 %)', v_rows, v_groups;
  end if;

  -- 되돌린다 — 확정 해제가 장부 행도 지운다
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform unconfirm_dues_charge(v_c1);
  if v_c2 <> v_c1 then perform unconfirm_dues_charge(v_c2); end if;
  perform set_config('request.jwt.claims', null, true);
  delete from crew_dues_charges where id in (v_c1, v_c2);

  select count(*) into v_n from crew_ledger
   where crew_id = v_crew and created_at >= v_started and source = 'dues';
  if v_n <> 0 then raise exception '가드: 검사용 장부 행 %건이 남았다', v_n; end if;
end $$;
