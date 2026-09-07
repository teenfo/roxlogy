-- ============================================================
-- Roxlogy — 크루 운영 로직을 행위자(actor) 인자를 받는 내부 헬퍼로 분리
--
-- MCP 는 anon 키로 들어와 auth.uid() 가 없다. 그래서 is_crew_staff 로 검사하는
-- 기존 함수를 그대로 부를 수 없고, 토큰으로 운영진을 확인한 뒤 같은 일을 해야
-- 한다. 로직을 두 벌 두면 반드시 어긋나므로(요금 계산·무료 행사 처리·중복
-- 방지가 전부 여기 있다) 핵심을 헬퍼로 뽑고 웹용 함수와 MCP 함수가 둘 다
-- 그것을 부르게 한다.
--
-- 내부 헬퍼(rox_*)는 호출자 검증이 없다 — anon·authenticated 에 절대 grant
-- 하지 않는다. 검증은 부르는 쪽(웹=is_crew_staff, MCP=mcp_staff_crew)이 한다.
-- ============================================================

create or replace function public.rox_check_in(
  p_crew uuid, p_event uuid, p_user uuid, p_present boolean, p_actor uuid
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_title text; v_starts timestamptz; v_free boolean;
  v_fee int; v_tier uuid; v_period text;
begin
  select title, starts_at, fee_exempt into v_title, v_starts, v_free
    from crew_events where id = p_event and crew_id = p_crew and cancelled_at is null;
  if v_title is null then raise exception 'event_not_found'; end if;
  if not exists (
    select 1 from crew_members m
    where m.crew_id = p_crew and m.user_id = p_user and m.status = 'active'
  ) then raise exception 'attend_not_member'; end if;

  if p_present then
    insert into crew_event_rsvps(event_id, user_id, status, checked_in_at)
    values (p_event, p_user, 'going', now())
    on conflict (event_id, user_id) do update set checked_in_at = now();

    if not v_free then
      select t.session_fee, t.id into v_fee, v_tier
        from crew_members m join crew_member_tiers t on t.id = m.tier_id
       where m.crew_id = p_crew and m.user_id = p_user;
      if v_fee is not null then
        v_period := to_char(v_starts at time zone 'Asia/Seoul', 'YYYY-MM');
        insert into crew_dues_charges
          (crew_id, user_id, kind, label, amount, period, event_id, tier_id, created_by)
        values (p_crew, p_user, 'session', left(v_title, 120), v_fee, v_period,
                p_event, v_tier, p_actor)
        on conflict (crew_id, user_id, event_id) where kind = 'session' do nothing;
      end if;
    end if;
  else
    update crew_event_rsvps set checked_in_at = null
     where event_id = p_event and user_id = p_user;
    delete from crew_dues_charges
     where event_id = p_event and user_id = p_user
       and kind = 'session' and status = 'pending';
  end if;
end;
$$;
revoke all on function public.rox_check_in(uuid, uuid, uuid, boolean, uuid) from public;

create or replace function public.crew_event_check_in(
  p_event uuid, p_user uuid, p_present boolean
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select crew_id into v_crew from crew_events
   where id = p_event and cancelled_at is null;
  if v_crew is null then raise exception 'event_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'attend_not_staff';
  end if;
  perform public.rox_check_in(v_crew, p_event, p_user, p_present, auth.uid());
end;
$$;
grant execute on function public.crew_event_check_in(uuid, uuid, boolean) to authenticated;

create or replace function public.rox_generate_monthly(
  p_crew uuid, p_period text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_created int := 0; v_updated int := 0; v_removed int := 0; v_locked int := 0;
begin
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'dues_bad_period'; end if;

  insert into crew_dues_charges
    (crew_id, user_id, kind, label, amount, period, tier_id, created_by)
  select m.crew_id, m.user_id, 'monthly',
         p_period || ' ' || t.name || ' 월회비', t.monthly_fee, p_period, t.id, p_actor
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
revoke all on function public.rox_generate_monthly(uuid, text, uuid) from public;

create or replace function public.rox_generate_session(
  p_crew uuid, p_period text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_created int := 0; v_updated int := 0; v_removed int := 0; v_locked int := 0;
begin
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'dues_bad_period'; end if;

  insert into crew_dues_charges
    (crew_id, user_id, kind, label, amount, period, event_id, tier_id, created_by)
  select e.crew_id, r.user_id, 'session', left(e.title, 120), t.session_fee,
         p_period, e.id, t.id, p_actor
  from crew_events e
  join crew_event_rsvps r on r.event_id = e.id and r.checked_in_at is not null
  join crew_members m on m.crew_id = e.crew_id and m.user_id = r.user_id and m.status = 'active'
  join crew_member_tiers t on t.id = m.tier_id
  where e.crew_id = p_crew and e.cancelled_at is null and not e.fee_exempt
    and to_char(e.starts_at at time zone 'Asia/Seoul', 'YYYY-MM') = p_period
    and t.session_fee is not null
  on conflict (crew_id, user_id, event_id) where kind = 'session' do nothing;
  get diagnostics v_created = row_count;

  update crew_dues_charges ch
     set amount = t.session_fee, tier_id = t.id, label = left(e.title, 120)
    from crew_events e, crew_members m, crew_member_tiers t
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status = 'pending'
     and e.id = ch.event_id and e.cancelled_at is null and not e.fee_exempt
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
       where e.id = ch.event_id and e.cancelled_at is null and not e.fee_exempt);
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
revoke all on function public.rox_generate_session(uuid, text, uuid) from public;

create or replace function public.generate_monthly_charges(p_crew uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  return public.rox_generate_monthly(p_crew, p_period, auth.uid());
end;
$$;
grant execute on function public.generate_monthly_charges(uuid, text) to authenticated;

create or replace function public.generate_session_charges(p_crew uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  return public.rox_generate_session(p_crew, p_period, auth.uid());
end;
$$;
grant execute on function public.generate_session_charges(uuid, text) to authenticated;

create or replace function public.rox_waive_charge(
  p_charge uuid, p_reason text, p_actor uuid
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_status text;
begin
  select status into v_status from crew_dues_charges where id = p_charge;
  if v_status is null then raise exception 'charge_not_found'; end if;
  if v_status = 'confirmed' then raise exception 'dues_already_confirmed'; end if;
  if v_status = 'waived' then return; end if;
  update crew_dues_charges
     set status = 'waived', waived_at = now(), waived_by = p_actor,
         waive_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         reported_at = null
   where id = p_charge;
end;
$$;
revoke all on function public.rox_waive_charge(uuid, text, uuid) from public;

create or replace function public.waive_dues_charge(
  p_charge uuid, p_reason text default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select crew_id into v_crew from crew_dues_charges where id = p_charge;
  if v_crew is null then raise exception 'charge_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  perform public.rox_waive_charge(p_charge, p_reason, auth.uid());
end;
$$;
grant execute on function public.waive_dues_charge(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.rox_check_in(uuid, uuid, uuid, boolean, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.rox_check_in(uuid, uuid, uuid, boolean, uuid)', 'execute')
     or has_function_privilege('anon', 'public.rox_generate_monthly(uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.rox_generate_monthly(uuid, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.rox_generate_session(uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.rox_generate_session(uuid, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.rox_waive_charge(uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.rox_waive_charge(uuid, text, uuid)', 'execute') then
    raise exception '가드: 검증 없는 내부 헬퍼가 클라이언트에 노출됐습니다';
  end if;

  if not has_function_privilege('authenticated', 'public.crew_event_check_in(uuid, uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.generate_monthly_charges(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.generate_session_charges(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.waive_dues_charge(uuid, text)', 'execute') then
    raise exception '가드: 공개 회비 RPC 의 execute 가 빠졌습니다';
  end if;
end $$;
