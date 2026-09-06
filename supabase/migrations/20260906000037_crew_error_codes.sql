-- ============================================================
-- Roxlogy — 새 크루 RPC 의 예외를 로케일 중립 코드로
--
-- 20260830000021 에서 회비 예외를 코드로 바꿨는데, 이번에 추가한 등급·
-- 출석·회비청구 RPC 가 다시 한국어 문장을 던지고 있었다. en/es 사용자에게
-- 한국어가 그대로 노출되므로 전부 코드로 바꾸고 화면에서 번역한다.
-- ============================================================

create or replace function public.report_dues_charge(p_charge uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_status text;
begin
  select user_id, status into v_owner, v_status from crew_dues_charges where id = p_charge;
  if v_owner is null then raise exception 'charge_not_found'; end if;
  if v_owner <> auth.uid() then raise exception 'dues_not_owner'; end if;
  if v_status = 'confirmed' then raise exception 'dues_already_confirmed'; end if;
  update crew_dues_charges
     set status = case when p_on then 'reported' else 'pending' end,
         reported_at = case when p_on then now() else null end
   where id = p_charge;
end;
$$;

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

create or replace function public.unconfirm_dues_charge(p_charge uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select * into c from crew_dues_charges where id = p_charge;
  if c is null then raise exception 'charge_not_found'; end if;
  if not ((select is_crew_staff(c.crew_id)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  if c.ledger_id is not null then delete from crew_ledger where id = c.ledger_id; end if;
  update crew_dues_charges
     set status = 'pending', confirmed_at = null, confirmed_by = null, ledger_id = null
   where id = p_charge;
end;
$$;

create or replace function public.generate_monthly_charges(p_crew uuid, p_period text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer := 0;
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
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.crew_event_check_in(
  p_event uuid, p_user uuid, p_present boolean
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid; v_title text; v_starts timestamptz;
  v_fee int; v_tier uuid; v_period text;
begin
  select crew_id, title, starts_at into v_crew, v_title, v_starts
    from crew_events where id = p_event and cancelled_at is null;
  if v_crew is null then raise exception 'event_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'attend_not_staff';
  end if;
  if not exists (
    select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception 'attend_not_member';
  end if;

  if p_present then
    insert into crew_event_rsvps(event_id, user_id, status, checked_in_at)
    values (p_event, p_user, 'going', now())
    on conflict (event_id, user_id) do update set checked_in_at = now();

    select t.session_fee, t.id into v_fee, v_tier
      from crew_members m join crew_member_tiers t on t.id = m.tier_id
     where m.crew_id = v_crew and m.user_id = p_user;
    if v_fee is not null then
      v_period := to_char(v_starts at time zone 'Asia/Seoul', 'YYYY-MM');
      insert into crew_dues_charges
        (crew_id, user_id, kind, label, amount, period, event_id, tier_id, created_by)
      values (v_crew, p_user, 'session', left(v_title, 120), v_fee, v_period,
              p_event, v_tier, auth.uid())
      on conflict (crew_id, user_id, event_id) where kind = 'session' do nothing;
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

create or replace function public.set_crew_tier(p_slug text, p_user uuid, p_tier uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select id into v_crew from crews where slug = p_slug;
  if v_crew is null then raise exception 'crew_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'tier_not_staff';
  end if;
  if p_tier is not null and not exists (
    select 1 from crew_member_tiers where id = p_tier and crew_id = v_crew
  ) then raise exception 'tier_wrong_crew'; end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set tier_id = p_tier
   where crew_id = v_crew and user_id = p_user;
end;
$$;

create or replace function public.delete_crew_tier(p_tier uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_used int; v_def boolean;
begin
  select crew_id, is_default into v_crew, v_def from crew_member_tiers where id = p_tier;
  if v_crew is null then raise exception 'tier_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'tier_not_staff';
  end if;
  if v_def then raise exception 'tier_is_default'; end if;
  select count(*) into v_used from crew_members where tier_id = p_tier;
  if v_used > 0 then
    update crew_member_tiers set archived_at = now(), is_default = false where id = p_tier;
    return 'archived';
  end if;
  delete from crew_member_tiers where id = p_tier;
  return 'deleted';
end;
$$;

-- 가드: 새 RPC 본문에 한글 예외 문장이 남아 있으면 실패시킨다 -----------------
do $$
declare r record;
begin
  for r in
    select proname, pg_get_functiondef(oid) as def from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('report_dues_charge', 'confirm_dues_charge',
                       'unconfirm_dues_charge', 'generate_monthly_charges',
                       'crew_event_check_in', 'set_crew_tier', 'delete_crew_tier')
  loop
    -- raise exception '<한글>' 형태가 남아 있는지
    if r.def ~ 'raise exception ''[^'']*[가-힣]' then
      raise exception '가드: %() 가 아직 한국어 예외를 던집니다', r.proname;
    end if;
  end loop;
end $$;
