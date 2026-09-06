-- ============================================================
-- Roxlogy — 복합 회비 (월회비 + 회차비)
--
-- crew_dues_payments 는 (크루, 회원, YYYY-MM) 유니크라 한 달에 한 건밖에
-- 못 담았다. "정회원 월회비 + 회차당 회비", "게스트 회차당 회비" 를
-- 표현할 수 없어서 청구 단위 장부로 바꾼다.
--
--   요금표 = crew_member_tiers.monthly_fee / session_fee (등급이 곧 요금)
--   청구   = crew_dues_charges 1행 = 1건
--     · monthly : period='2026-09'      (운영진이 월 단위로 일괄 생성)
--     · session : event_id=모임          (출석 체크하면 자동 생성)
--     · custom  : 임의 항목
--
-- 확정하면 회계(crew_ledger)에 수입이 기록되고 charge.ledger_id 로 묶인다.
-- 확정을 해제하면 그 회계 행도 함께 지운다 — 잘못 누른 확정이 수입으로
-- 영구히 남으면 장부가 맞지 않는다.
-- 기존 crew_dues_payments 는 행이 0건이라 그대로 폐기한다.
-- ============================================================

create table if not exists public.crew_dues_charges (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('monthly', 'session', 'custom')),
  label text not null check (char_length(label) between 1 and 120),
  amount int not null check (amount > 0),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  event_id uuid references public.crew_events(id) on delete cascade,
  -- 청구 당시 등급 (나중에 등급이 바뀌어도 이력이 남게)
  tier_id uuid references public.crew_member_tiers(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'reported', 'confirmed')),
  reported_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  ledger_id uuid references public.crew_ledger(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- 모임 청구에는 반드시 모임이, 월회비에는 없어야 한다
  check ((kind = 'session') = (event_id is not null))
);

create unique index if not exists crew_dues_charges_monthly_uq
  on public.crew_dues_charges(crew_id, user_id, period) where kind = 'monthly';
create unique index if not exists crew_dues_charges_session_uq
  on public.crew_dues_charges(crew_id, user_id, event_id) where kind = 'session';
create index if not exists crew_dues_charges_crew_period_idx
  on public.crew_dues_charges(crew_id, period);
create index if not exists crew_dues_charges_user_idx
  on public.crew_dues_charges(user_id, status);
create index if not exists crew_dues_charges_event_idx
  on public.crew_dues_charges(event_id);
create index if not exists crew_dues_charges_tier_idx
  on public.crew_dues_charges(tier_id);
create index if not exists crew_dues_charges_ledger_idx
  on public.crew_dues_charges(ledger_id);

alter table public.crew_dues_charges enable row level security;

create policy crew_dues_charges_select on public.crew_dues_charges
  for select using (
    user_id = (select auth.uid())
    or (select is_crew_staff(crew_id)) or (select is_admin())
  );
create policy crew_dues_charges_insert on public.crew_dues_charges
  for insert with check ((select is_crew_staff(crew_id)) or (select is_admin()));
create policy crew_dues_charges_update on public.crew_dues_charges
  for update using ((select is_crew_staff(crew_id)) or (select is_admin()))
  with check ((select is_crew_staff(crew_id)) or (select is_admin()));
create policy crew_dues_charges_delete on public.crew_dues_charges
  for delete using ((select is_crew_staff(crew_id)) or (select is_admin()));

-- 본인 납부 신고 -------------------------------------------------------------
create or replace function public.report_dues_charge(p_charge uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_status text;
begin
  select user_id, status into v_owner, v_status from crew_dues_charges where id = p_charge;
  if v_owner is null then raise exception '청구를 찾을 수 없습니다'; end if;
  if v_owner <> auth.uid() then raise exception '본인 청구만 신고할 수 있습니다'; end if;
  if v_status = 'confirmed' then raise exception '이미 확정된 청구입니다'; end if;
  update crew_dues_charges
     set status = case when p_on then 'reported' else 'pending' end,
         reported_at = case when p_on then now() else null end
   where id = p_charge;
end;
$$;
grant execute on function public.report_dues_charge(uuid, boolean) to authenticated;

-- 운영진 확정 / 해제 ---------------------------------------------------------
create or replace function public.confirm_dues_charge(p_charge uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record; v_name text; v_ledger uuid;
begin
  select * into c from crew_dues_charges where id = p_charge;
  if c is null then raise exception '청구를 찾을 수 없습니다'; end if;
  if not ((select is_crew_staff(c.crew_id)) or (select is_admin())) then
    raise exception '운영진만 납부를 확정할 수 있습니다';
  end if;
  if c.status = 'confirmed' then return; end if;  -- 멱등 — 중복 회계 방지

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
grant execute on function public.confirm_dues_charge(uuid) to authenticated;

create or replace function public.unconfirm_dues_charge(p_charge uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select * into c from crew_dues_charges where id = p_charge;
  if c is null then raise exception '청구를 찾을 수 없습니다'; end if;
  if not ((select is_crew_staff(c.crew_id)) or (select is_admin())) then
    raise exception '운영진만 확정을 해제할 수 있습니다';
  end if;
  -- 확정으로 만들어진 회계 수입도 함께 되돌린다
  if c.ledger_id is not null then delete from crew_ledger where id = c.ledger_id; end if;
  update crew_dues_charges
     set status = 'pending', confirmed_at = null, confirmed_by = null, ledger_id = null
   where id = p_charge;
end;
$$;
grant execute on function public.unconfirm_dues_charge(uuid) to authenticated;

-- 월회비 일괄 생성 -----------------------------------------------------------
create or replace function public.generate_monthly_charges(p_crew uuid, p_period text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer := 0;
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception '운영진만 회비를 청구할 수 있습니다';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception '기간은 YYYY-MM 형식이어야 합니다'; end if;

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
grant execute on function public.generate_monthly_charges(uuid, text) to authenticated;

-- 출석 체크에 회차비 자동 청구 -------------------------------------------------
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
  if v_crew is null then raise exception '모임을 찾을 수 없습니다'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception '운영진만 출석을 체크할 수 있습니다';
  end if;
  if not exists (
    select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception '크루원이 아닙니다';
  end if;

  if p_present then
    insert into crew_event_rsvps(event_id, user_id, status, checked_in_at)
    values (p_event, p_user, 'going', now())
    on conflict (event_id, user_id) do update set checked_in_at = now();

    -- 등급에 회차비가 있으면 출석과 동시에 청구한다
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
    -- 아직 손대지 않은 청구만 회수한다 (신고·확정된 건 회계에 영향)
    delete from crew_dues_charges
     where event_id = p_event and user_id = p_user
       and kind = 'session' and status = 'pending';
  end if;
end;
$$;
grant execute on function public.crew_event_check_in(uuid, uuid, boolean) to authenticated;

-- 조회 RPC -------------------------------------------------------------------
-- 운영진 회비 보드: 해당 월의 청구 전부 (회원 이름·등급 포함)
create or replace function public.crew_dues_board(p_slug text, p_period text)
returns table(
  charge_id uuid, user_id uuid, display_name text,
  tier_name text, tier_color text,
  kind text, label text, amount int, status text, event_at timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  select ch.id, ch.user_id, coalesce(p.display_name, 'Athlete'),
         t.name, t.color, ch.kind, ch.label, ch.amount, ch.status, e.starts_at
  from crew_dues_charges ch
  join crews c on c.id = ch.crew_id
  join profiles p on p.id = ch.user_id
  left join crew_member_tiers t on t.id = ch.tier_id
  left join crew_events e on e.id = ch.event_id
  where c.slug = p_slug and ch.period = p_period
    and ((select is_crew_staff(c.id)) or (select is_admin()))
  order by coalesce(p.display_name, 'Athlete'),
           case ch.kind when 'monthly' then 0 else 1 end, e.starts_at, ch.created_at;
$$;
grant execute on function public.crew_dues_board(text, text) to authenticated;

-- 본인 회비 내역: 미납 먼저
create or replace function public.my_dues_charges(p_slug text, p_limit integer default 40)
returns table(
  charge_id uuid, kind text, label text, amount int, status text,
  period text, created_at timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  select ch.id, ch.kind, ch.label, ch.amount, ch.status, ch.period, ch.created_at
  from crew_dues_charges ch
  join crews c on c.id = ch.crew_id
  where c.slug = p_slug and ch.user_id = auth.uid()
  order by case ch.status when 'pending' then 0 when 'reported' then 1 else 2 end,
           ch.period desc, ch.created_at desc
  limit least(p_limit, 200);
$$;
grant execute on function public.my_dues_charges(text, integer) to authenticated;

