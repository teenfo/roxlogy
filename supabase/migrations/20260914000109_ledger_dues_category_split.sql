-- ============================================================
-- Roxlogy — 수입 분류에서 회비를 월회비·회차비로 쪼갠다
--
-- 106 에서 수입 분류를 dues·sponsor·carryover 로 뒀는데, 회비는 성격이 다른
-- 두 가지가 한 칸에 들어 있었다: 달마다 걷는 월회비와 모임마다 걷는 회차비.
-- 장부에서 "이 달 월회비로 얼마 들어왔나"를 보려면 갈라져 있어야 한다.
--
--   수입: dues_monthly · dues_session · dues_other · sponsor · carryover
--   지출: venue · snack · gear · race · other   (그대로)
--
-- 회비 확정(confirm_dues_charge)이 청구 종류를 그대로 분류에 적는다 — 운영진이
-- 손으로 고를 일이 없다. 손으로 적는 수입에서는 골라 쓸 수 있게 목록에도 둔다.
--
-- 아직 category = 'dues' 인 행은 없다(분류는 106 이후 손으로 적은 지출 4건뿐).
-- 그래서 값을 옮기는 게 아니라 제약을 갈아 끼우고 회비 행을 소급해 채운다.
-- ============================================================

alter table public.crew_ledger
  drop constraint if exists crew_ledger_category_kind_ck;

alter table public.crew_ledger
  add constraint crew_ledger_category_kind_ck check (
    category is null
    or (kind = 'income'
        and category in ('dues_monthly', 'dues_session', 'dues_other', 'sponsor', 'carryover'))
    or (kind = 'expense'
        and category in ('venue', 'snack', 'gear', 'race', 'other'))
  );

comment on column public.crew_ledger.category is
  '거래 분류(영어 키, 화면에서 번역). 수입: dues_monthly·dues_session·dues_other·sponsor·carryover / 지출: venue·snack·gear·race·other. null = 미분류.';

-- ---------- 확정 시 분류도 같이 적는다 ------------------------------------
-- 108 의 정의에 category 만 더한다(나머지 동작은 그대로).
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
                           dues_group, category, created_by)
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
          auth.uid())
  returning id into v_ledger;

  update crew_dues_charges
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(),
         ledger_id = v_ledger
   where id = p_charge;
end;
$$;

-- ---------- 이미 확정된 회비 행 소급 --------------------------------------
-- 마감된 달은 건드리지 않는다 — 장부 잠금 트리거가 category 변경도 막는다
-- (106·108). 소급을 못 해도 화면은 dues_group 으로 묶으므로 손해가 없다.
update public.crew_ledger l
   set category = case
         when l.dues_group like 'monthly:%' then 'dues_monthly'
         when l.dues_group like 'session:%' then 'dues_session'
         else 'dues_other'
       end
 where l.source = 'dues'
   and l.category is null
   and l.dues_group is not null
   and not public.is_month_closed(l.crew_id, to_char(l.entry_date, 'YYYY-MM'));

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_n int;
  v_crew uuid;
  v_user uuid;
  v_id uuid;
  v_ok boolean;
begin
  -- 1) 회비 행이 분류 없이 남아 있으면 안 된다 (마감된 달 제외)
  select count(*) into v_n
    from crew_ledger l
   where l.source = 'dues' and l.dues_group is not null and l.category is null
     and not is_month_closed(l.crew_id, to_char(l.entry_date, 'YYYY-MM'));
  if v_n > 0 then raise exception '가드: 분류가 빈 회비 장부 행 %건', v_n; end if;

  -- 2) 회차 키와 분류가 짝이 맞아야 한다
  select count(*) into v_n
    from crew_ledger l
   where l.category is not null
     and ((l.dues_group like 'monthly:%' and l.category <> 'dues_monthly')
       or (l.dues_group like 'session:%' and l.category <> 'dues_session')
       or (l.dues_group like 'custom:%' and l.category <> 'dues_other'));
  if v_n > 0 then raise exception '가드: 회차 키와 분류가 어긋난 행 %건', v_n; end if;

  -- 3) 옛 'dues' 값은 이제 들어가지 않는다
  select c.id into v_crew from crews c
   where not is_month_closed(c.id, to_char(current_date, 'YYYY-MM')) limit 1;
  if v_crew is null then
    raise notice '가드: 쓸 수 있는 크루가 없어 제약 검사를 건너뛴다';
    return;
  end if;
  select created_by into v_user from crew_ledger where crew_id = v_crew limit 1;

  insert into crew_ledger (crew_id, entry_date, kind, amount, title, category, created_by)
  values (v_crew, current_date, 'income', 1, '__guard__', 'dues_monthly', v_user)
  returning id into v_id;

  v_ok := false;
  begin
    update crew_ledger set category = 'dues' where id = v_id;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 옛 dues 분류가 그대로 들어갔다'; end if;

  -- 4) 지출 행에는 회비 분류가 못 들어간다
  v_ok := false;
  begin
    update crew_ledger set kind = 'expense' where id = v_id;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 지출 행에 월회비 분류가 남았다'; end if;

  delete from crew_ledger where id = v_id;
end $$;
