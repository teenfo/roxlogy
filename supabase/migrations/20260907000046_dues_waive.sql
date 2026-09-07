-- ============================================================
-- Roxlogy — 회비 면제 (청구서 단위)
--
-- 면제를 크루원 설정에 두면 "이 사람은 항상 면제"만 표현할 수 있다.
-- 실제로는 이번 달만 면제, 이 모임만 면제(부상·운영 도움·초대 게스트)처럼
-- 건별로 정해지는 경우가 대부분이라 청구서에 붙인다.
--
-- status 에 'waived' 를 추가한다. 면제는 미납도 수입도 아니다:
--   · 미납 합계에서 빠진다
--   · 회계(crew_ledger)에는 아무것도 기록하지 않는다 (돈이 오가지 않았다)
--   · 대사(reconcile)가 건드리지 않는다 — pending 만 갱신·회수하므로 자동
--   · 부분 유니크 인덱스가 같은 자리에 새 청구가 생기는 것도 막는다
-- 면제 사유를 남겨 나중에 왜 면제했는지 회계에서 확인할 수 있게 한다.
-- ============================================================

alter table public.crew_dues_charges
  drop constraint if exists crew_dues_charges_status_check;
alter table public.crew_dues_charges
  add constraint crew_dues_charges_status_check
    check (status in ('pending', 'reported', 'confirmed', 'waived'));

alter table public.crew_dues_charges
  add column if not exists waived_at timestamptz,
  add column if not exists waived_by uuid references public.profiles(id) on delete set null,
  add column if not exists waive_reason text
    check (waive_reason is null or char_length(waive_reason) <= 200);

-- 면제 / 면제 해제 --------------------------------------------------------------
create or replace function public.waive_dues_charge(
  p_charge uuid, p_reason text default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select * into c from crew_dues_charges where id = p_charge;
  if c is null then raise exception 'charge_not_found'; end if;
  if not ((select is_crew_staff(c.crew_id)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  -- 확정된 건은 이미 회계에 수입으로 잡혀 있다. 면제하려면 먼저 확정을 해제해
  -- 그 회계 행을 되돌려야 장부가 맞는다.
  if c.status = 'confirmed' then raise exception 'dues_already_confirmed'; end if;
  if c.status = 'waived' then return; end if;

  update crew_dues_charges
     set status = 'waived', waived_at = now(), waived_by = auth.uid(),
         waive_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         reported_at = null
   where id = p_charge;
end;
$$;
grant execute on function public.waive_dues_charge(uuid, text) to authenticated;

create or replace function public.unwaive_dues_charge(p_charge uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select * into c from crew_dues_charges where id = p_charge;
  if c is null then raise exception 'charge_not_found'; end if;
  if not ((select is_crew_staff(c.crew_id)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  if c.status <> 'waived' then return; end if;
  update crew_dues_charges
     set status = 'pending', waived_at = null, waived_by = null, waive_reason = null
   where id = p_charge;
end;
$$;
grant execute on function public.unwaive_dues_charge(uuid) to authenticated;

-- 면제된 청구는 확정·신고 대상이 아니다 ---------------------------------------
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
  insert into crew_ledger (crew_id, entry_date, kind, amount, title, created_by)
  values (c.crew_id, app_today(), 'income', c.amount,
          left(c.label || ' — ' || coalesce(v_name, '멤버'), 120), auth.uid())
  returning id into v_ledger;

  update crew_dues_charges
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(),
         ledger_id = v_ledger
   where id = p_charge;
end;
$$;

create or replace function public.report_dues_charge(p_charge uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_status text;
begin
  select user_id, status into v_owner, v_status from crew_dues_charges where id = p_charge;
  if v_owner is null then raise exception 'charge_not_found'; end if;
  if v_owner <> auth.uid() then raise exception 'dues_not_owner'; end if;
  if v_status = 'confirmed' then raise exception 'dues_already_confirmed'; end if;
  if v_status = 'waived' then raise exception 'dues_waived'; end if;
  update crew_dues_charges
     set status = case when p_on then 'reported' else 'pending' end,
         reported_at = case when p_on then now() else null end
   where id = p_charge;
end;
$$;

-- 대사의 locked 집계에서 면제분 제외 (금액이 어긋나든 말든 의미 없다) ----------
create or replace function public.generate_monthly_charges(p_crew uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_created int := 0; v_updated int := 0; v_removed int := 0; v_locked int := 0;
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'dues_bad_period'; end if;

  insert into crew_dues_charges
    (crew_id, user_id, kind, label, amount, period, tier_id, created_by)
  select m.crew_id, m.user_id, 'monthly',
         p_period || ' ' || t.name || ' 월회비', t.monthly_fee, p_period, t.id, auth.uid()
  from crew_members m
  join crew_member_tiers t on t.id = m.tier_id
  where m.crew_id = p_crew and m.status = 'active' and t.monthly_fee is not null
  on conflict (crew_id, user_id, period) where kind = 'monthly' do nothing;
  get diagnostics v_created = row_count;

  update crew_dues_charges ch
     set amount = t.monthly_fee, tier_id = t.id,
         label = p_period || ' ' || t.name || ' 월회비'
    from crew_members m
    join crew_member_tiers t on t.id = m.tier_id
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'monthly'
     and ch.status = 'pending'
     and m.crew_id = ch.crew_id and m.user_id = ch.user_id and m.status = 'active'
     and t.monthly_fee is not null
     and (ch.amount is distinct from t.monthly_fee or ch.tier_id is distinct from t.id);
  get diagnostics v_updated = row_count;

  delete from crew_dues_charges ch
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'monthly'
     and ch.status = 'pending'
     and not exists (
       select 1 from crew_members m
       join crew_member_tiers t on t.id = m.tier_id
       where m.crew_id = ch.crew_id and m.user_id = ch.user_id
         and m.status = 'active' and t.monthly_fee is not null);
  get diagnostics v_removed = row_count;

  select count(*) into v_locked
    from crew_dues_charges ch
    join crew_members m on m.crew_id = ch.crew_id and m.user_id = ch.user_id
    join crew_member_tiers t on t.id = m.tier_id
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'monthly'
     and ch.status in ('reported', 'confirmed')
     and ch.amount is distinct from t.monthly_fee;

  return jsonb_build_object('created', v_created, 'updated', v_updated,
                            'removed', v_removed, 'locked', v_locked);
end;
$$;

create or replace function public.generate_session_charges(p_crew uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_created int := 0; v_updated int := 0; v_removed int := 0; v_locked int := 0;
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'dues_bad_period'; end if;

  insert into crew_dues_charges
    (crew_id, user_id, kind, label, amount, period, event_id, tier_id, created_by)
  select e.crew_id, r.user_id, 'session', left(e.title, 120), t.session_fee,
         p_period, e.id, t.id, auth.uid()
  from crew_events e
  join crew_event_rsvps r on r.event_id = e.id and r.checked_in_at is not null
  join crew_members m on m.crew_id = e.crew_id and m.user_id = r.user_id and m.status = 'active'
  join crew_member_tiers t on t.id = m.tier_id
  where e.crew_id = p_crew and e.cancelled_at is null
    and to_char(e.starts_at at time zone 'Asia/Seoul', 'YYYY-MM') = p_period
    and t.session_fee is not null
  on conflict (crew_id, user_id, event_id) where kind = 'session' do nothing;
  get diagnostics v_created = row_count;

  update crew_dues_charges ch
     set amount = t.session_fee, tier_id = t.id, label = left(e.title, 120)
    from crew_events e, crew_members m, crew_member_tiers t
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status = 'pending'
     and e.id = ch.event_id and e.cancelled_at is null
     and m.crew_id = ch.crew_id and m.user_id = ch.user_id and m.status = 'active'
     and t.id = m.tier_id and t.session_fee is not null
     and (ch.amount is distinct from t.session_fee
          or ch.tier_id is distinct from t.id
          or ch.label is distinct from left(e.title, 120));
  get diagnostics v_updated = row_count;

  delete from crew_dues_charges ch
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status = 'pending'
     and not exists (
       select 1 from crew_events e
       join crew_event_rsvps r on r.event_id = e.id and r.user_id = ch.user_id
                              and r.checked_in_at is not null
       join crew_members m on m.crew_id = e.crew_id and m.user_id = ch.user_id
                          and m.status = 'active'
       join crew_member_tiers t on t.id = m.tier_id and t.session_fee is not null
       where e.id = ch.event_id and e.cancelled_at is null);
  get diagnostics v_removed = row_count;

  select count(*) into v_locked
    from crew_dues_charges ch
    join crew_members m on m.crew_id = ch.crew_id and m.user_id = ch.user_id
    join crew_member_tiers t on t.id = m.tier_id
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status in ('reported', 'confirmed')
     and ch.amount is distinct from t.session_fee;

  return jsonb_build_object('created', v_created, 'updated', v_updated,
                            'removed', v_removed, 'locked', v_locked);
end;
$$;

-- 조회에 면제 정보 노출 ---------------------------------------------------------
drop function if exists public.crew_dues_board(text, text);
create function public.crew_dues_board(p_slug text, p_period text)
returns table(
  charge_id uuid, user_id uuid, display_name text, email text,
  tier_name text, tier_color text,
  kind text, label text, amount int, status text, event_at timestamptz,
  waive_reason text
)
language sql stable security definer set search_path to 'public' as $$
  select ch.id, ch.user_id, coalesce(p.display_name, 'Athlete'),
         case when (select is_crew_staff(c.id)) or (select is_admin())
              then u.email::text else null end,
         t.name, t.color, ch.kind, ch.label, ch.amount, ch.status, e.starts_at,
         ch.waive_reason
  from crew_dues_charges ch
  join crews c on c.id = ch.crew_id
  join profiles p on p.id = ch.user_id
  left join auth.users u on u.id = ch.user_id
  left join crew_member_tiers t on t.id = ch.tier_id
  left join crew_events e on e.id = ch.event_id
  where c.slug = p_slug and ch.period = p_period
    and ((select is_crew_staff(c.id)) or (select is_admin()))
  order by coalesce(p.display_name, 'Athlete'),
           case ch.kind when 'monthly' then 0 else 1 end, e.starts_at, ch.created_at;
$$;
grant execute on function public.crew_dues_board(text, text) to authenticated;

drop function if exists public.my_dues_charges(text, integer);
create function public.my_dues_charges(p_slug text, p_limit integer default 40)
returns table(
  charge_id uuid, kind text, label text, amount int, status text,
  period text, created_at timestamptz, waive_reason text
)
language sql stable security definer set search_path to 'public' as $$
  select ch.id, ch.kind, ch.label, ch.amount, ch.status, ch.period, ch.created_at,
         ch.waive_reason
  from crew_dues_charges ch
  join crews c on c.id = ch.crew_id
  where c.slug = p_slug and ch.user_id = auth.uid()
  order by case ch.status when 'pending' then 0 when 'reported' then 1 else 2 end,
           ch.period desc, ch.created_at desc
  limit least(p_limit, 200);
$$;
grant execute on function public.my_dues_charges(text, integer) to authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare
  v_crew uuid; v_owner uuid; v_charge uuid; v_st text; n int; j jsonb;
  ledger_before int; ledger_after int;
begin
  select id into v_crew from public.crews where slug = 'loop8';
  if v_crew is null then return; end if;
  select user_id into v_owner from public.crew_members
   where crew_id = v_crew and role = 'owner' limit 1;
  select id into v_charge from public.crew_dues_charges
   where crew_id = v_crew and status = 'pending' limit 1;
  if v_owner is null or v_charge is null then return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  select count(*) into ledger_before from public.crew_ledger where crew_id = v_crew;

  -- (a) 면제하면 상태가 waived 가 되고 회계에는 아무것도 안 남는다
  perform public.waive_dues_charge(v_charge, '테스트 사유');
  select status into v_st from public.crew_dues_charges where id = v_charge;
  select count(*) into ledger_after from public.crew_ledger where crew_id = v_crew;
  if v_st <> 'waived' or ledger_after <> ledger_before then
    raise exception '가드: 면제 처리가 잘못됐습니다 (상태=% 회계 %→%)',
      v_st, ledger_before, ledger_after;
  end if;

  -- (b) 면제된 건은 확정할 수 없다
  begin
    perform public.confirm_dues_charge(v_charge);
    raise exception '가드: 면제된 청구가 확정됐습니다';
  exception when others then
    if sqlerrm not like '%dues_waived%' then raise; end if;
  end;

  -- (c) 대사가 면제분을 되살리거나 덮어쓰지 않는다
  j := public.generate_monthly_charges(v_crew, '2026-09');
  j := public.generate_session_charges(v_crew, '2026-09');
  select status into v_st from public.crew_dues_charges where id = v_charge;
  if v_st <> 'waived' then raise exception '가드: 대사가 면제분을 되돌렸습니다 (%)', v_st; end if;
  select count(*) into n from public.crew_dues_charges ch
   where ch.crew_id = v_crew
     and (ch.kind, ch.user_id, coalesce(ch.period,''), coalesce(ch.event_id, ch.crew_id))
       = (select ch2.kind, ch2.user_id, coalesce(ch2.period,''),
                 coalesce(ch2.event_id, ch2.crew_id)
            from public.crew_dues_charges ch2 where ch2.id = v_charge);
  if n <> 1 then raise exception '가드: 면제 자리에 중복 청구가 생겼습니다 (%건)', n; end if;

  -- (d) 면제 해제하면 미납으로 돌아온다
  perform public.unwaive_dues_charge(v_charge);
  select status into v_st from public.crew_dues_charges where id = v_charge;
  if v_st <> 'pending' then raise exception '가드: 면제 해제가 되지 않습니다 (%)', v_st; end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
