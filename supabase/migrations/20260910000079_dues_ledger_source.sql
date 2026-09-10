-- ============================================================
-- Roxlogy — 회비 확정으로 만든 장부 행에 source='dues' 표시
--
-- crew_dues_charges 시대의 confirm_dues_charge 가 source 를 채우지 않아,
-- 회계 화면의 "회비 · {내역}" 라벨 분기(r.source === 'dues')가 한 번도 타지
-- 않았다. 회비로 들어온 돈이 손으로 적은 수입과 구분되지 않는다.
-- (구 경로 set_dues_paid·mcp_confirm_dues 는 이미 'dues' 를 넣고 있었다)
-- ============================================================

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
  insert into crew_ledger (crew_id, entry_date, kind, amount, title, source, created_by)
  values (c.crew_id, app_today(), 'income', c.amount,
          left(c.label || ' — ' || coalesce(v_name, '멤버'), 120), 'dues', auth.uid())
  returning id into v_ledger;

  update crew_dues_charges
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(),
         ledger_id = v_ledger
   where id = p_charge;
end;
$$;

-- 이미 확정된 건들 — 청구가 들고 있는 ledger_id 로 되짚어 소급 표시
update public.crew_ledger l
   set source = 'dues'
  from public.crew_dues_charges ch
 where ch.ledger_id = l.id
   and l.source is distinct from 'dues';

-- 가드: 확정 청구가 가리키는 장부 행 중 source 가 비어 있는 게 남으면 안 된다
do $$
declare n int;
begin
  select count(*) into n
    from public.crew_dues_charges ch
    join public.crew_ledger l on l.id = ch.ledger_id
   where l.source is distinct from 'dues';
  if n > 0 then
    raise exception '가드: 회비 장부 행 %건에 source 가 비어 있습니다', n;
  end if;
end $$;
