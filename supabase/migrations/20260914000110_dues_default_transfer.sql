-- ============================================================
-- Roxlogy — 회비 확정으로 생기는 장부 행의 결제 수단을 '이체'로
--
-- 회비는 계좌로 받는 게 기본이다(2026-09-14 확인). 지금은 결제 수단이 비어
-- 나와서 운영진이 36건을 손으로 채워야 했다. 확정할 때 'transfer' 를 넣고,
-- 현금으로 받은 건처럼 다른 경우만 운영진이 행을 고치면 된다.
--
-- 결제 수단은 "어떻게 냈나"가 아니라 "이 돈이 통장에 언제 찍히나"를 가늠하려고
-- 있다(crew-ledger-form.tsx 주석). 이체가 기본값이면 통장 대사에서도 뜻이 통한다.
--
-- 기존 행은 건드리지 않는다 — 이미 손으로 맞춰 뒀고, 마감된 달이 있으면
-- 장부 잠금이 method 변경도 막는다(106·108 의 비교 튜플에 들어 있다).
-- ============================================================

-- 109 의 정의에 method 만 더한다(나머지 동작은 그대로).
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
  insert into crew_ledger (crew_id, entry_date, kind, amount, title, source,
                           dues_group, category, method, created_by)
  values (c.crew_id, app_today(), 'income', c.amount,
          left(c.label || ' — ' || coalesce(v_name, '멤버'), 120), 'dues',
          case c.kind
            when 'monthly' then 'monthly:' || c.period
            when 'session' then 'session:' || c.event_id::text
            else 'custom:' || c.id::text
          end,
          case c.kind
            when 'monthly' then 'dues_monthly'
            when 'session' then 'dues_session'
            else 'dues_other'
          end,
          'transfer',
          auth.uid())
  returning id into v_ledger;

  update crew_dues_charges
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(),
         ledger_id = v_ledger
   where id = p_charge;
end;
$$;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_crew uuid;
  v_staff uuid;
  v_charge uuid;
  v_method text;
  v_category text;
begin
  select c.id into v_crew from crews c
   join crew_members m on m.crew_id = c.id and m.role in ('owner','coach') and m.status = 'active'
   where not is_month_closed(c.id, to_char(app_today(), 'YYYY-MM'))
   limit 1;
  if v_crew is null then
    raise notice '가드: 쓸 수 있는 크루가 없어 검사를 건너뛴다';
    return;
  end if;
  select user_id into v_staff from crew_members
   where crew_id = v_crew and role in ('owner','coach') and status = 'active' limit 1;

  insert into crew_dues_charges (crew_id, user_id, kind, label, amount, period, status)
  values (v_crew, v_staff, 'monthly', '__guard__ 월회비', 1000, '2099-01', 'pending')
  returning id into v_charge;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform confirm_dues_charge(v_charge);

  select l.method, l.category into v_method, v_category
    from crew_ledger l join crew_dues_charges ch on ch.ledger_id = l.id
   where ch.id = v_charge;
  if v_method is distinct from 'transfer' then
    raise exception '가드: 확정 행의 결제 수단이 이체가 아니다 (%)', v_method;
  end if;
  if v_category is distinct from 'dues_monthly' then
    raise exception '가드: 확정 행의 분류가 월회비가 아니다 (%)', v_category;
  end if;

  perform unconfirm_dues_charge(v_charge);
  perform set_config('request.jwt.claims', null, true);
  delete from crew_dues_charges where id = v_charge;
end $$;
