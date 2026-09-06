-- ============================================================
-- Roxlogy — 회비 청구 (2) MCP 이설 + 구버전 월 장부 폐기
-- MCP 라우트가 p_month 라는 인자명으로 호출하므로 이름을 유지한다.
-- ============================================================

drop function if exists public.mcp_dues(text, text, text);
drop function if exists public.mcp_set_dues_paid(text, text, uuid, text, int);
drop function if exists public.mcp_report_dues(text, text, text);

-- MCP 를 청구 장부로 이설 -----------------------------------------------------
create or replace function public.mcp_dues(
  p_token text, p_slug text, p_month text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_uid uuid; v_period text; v_staff boolean;
begin
  select id into v_uid from profiles where mcp_token = p_token;
  if v_uid is null then return null; end if;
  select c.id into v_crew from crews c
   join crew_members m on m.crew_id = c.id and m.user_id = v_uid and m.status = 'active'
   where c.slug = p_slug;
  if v_crew is null then return null; end if;
  v_period := coalesce(p_month, to_char(app_today(), 'YYYY-MM'));
  select exists (select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = v_uid and m.role in ('owner','coach'))
    into v_staff;

  return jsonb_build_object(
    'period', v_period,
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'charge_id', ch.id, 'kind', ch.kind, 'label', ch.label,
        'amount', ch.amount, 'status', ch.status) order by ch.created_at)
      from crew_dues_charges ch
      where ch.crew_id = v_crew and ch.user_id = v_uid and ch.period = v_period), '[]'::jsonb),
    'crew', case when v_staff then coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', ch.user_id, 'name', coalesce(p.display_name, 'Athlete'),
        'charge_id', ch.id, 'kind', ch.kind, 'label', ch.label,
        'amount', ch.amount, 'status', ch.status)
        order by coalesce(p.display_name, 'Athlete'), ch.created_at)
      from crew_dues_charges ch join profiles p on p.id = ch.user_id
      where ch.crew_id = v_crew and ch.period = v_period), '[]'::jsonb) else null end
  );
end;
$$;

create or replace function public.mcp_set_dues_paid(
  p_token text, p_slug text, p_user_id uuid, p_month text, p_amount int default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_charge uuid; v_tier uuid;
begin
  if v_crew is null then return null; end if;
  if p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('error', 'bad_period_format');
  end if;

  select id into v_charge from crew_dues_charges
   where crew_id = v_crew and user_id = p_user_id and period = p_month and kind = 'monthly';
  if v_charge is null then
    if p_amount is null or p_amount <= 0 then
      return jsonb_build_object('error', 'no_charge_and_no_amount');
    end if;
    select tier_id into v_tier from crew_members where crew_id = v_crew and user_id = p_user_id;
    insert into crew_dues_charges
      (crew_id, user_id, kind, label, amount, period, tier_id, created_by)
    values (v_crew, p_user_id, 'monthly', p_month || ' 월회비', p_amount, p_month, v_tier,
            (select id from profiles where mcp_token = p_token))
    returning id into v_charge;
  elsif p_amount is not null and p_amount > 0 then
    update crew_dues_charges set amount = p_amount where id = v_charge and status <> 'confirmed';
  end if;

  perform public.confirm_dues_charge(v_charge);
  return jsonb_build_object('ok', true, 'charge_id', v_charge);
end;
$$;

create or replace function public.mcp_report_dues(
  p_token text, p_slug text, p_month text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_crew uuid; v_period text; n int;
begin
  select id into v_uid from profiles where mcp_token = p_token;
  if v_uid is null then return null; end if;
  select c.id into v_crew from crews c
   join crew_members m on m.crew_id = c.id and m.user_id = v_uid and m.status = 'active'
   where c.slug = p_slug;
  if v_crew is null then return null; end if;
  v_period := coalesce(p_month, to_char(app_today(), 'YYYY-MM'));

  update crew_dues_charges
     set status = 'reported', reported_at = now()
   where crew_id = v_crew and user_id = v_uid and period = v_period and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'period', v_period, 'reported', n);
end;
$$;

grant execute on function
  public.mcp_dues(text, text, text),
  public.mcp_set_dues_paid(text, text, uuid, text, int),
  public.mcp_report_dues(text, text, text)
to anon, authenticated;

-- 구버전 월 단위 장부 폐기 (행 0건) -------------------------------------------
drop function if exists public.set_dues_paid(uuid, uuid, text, int);
drop table if exists public.crew_dues_payments;

-- 가드 ------------------------------------------------------------------------
do $$
declare n int;
begin
  if to_regclass('public.crew_dues_payments') is not null then
    raise exception '가드: 구버전 crew_dues_payments 가 남아 있습니다';
  end if;
  if exists (select 1 from pg_proc where pronamespace='public'::regnamespace
              and proname='set_dues_paid') then
    raise exception '가드: 구버전 set_dues_paid 가 남아 있습니다';
  end if;

  -- 청구는 익명에게 절대 열리면 안 된다
  if has_function_privilege('anon', 'public.confirm_dues_charge(uuid)', 'execute')
     or has_function_privilege('anon', 'public.generate_monthly_charges(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.crew_dues_board(text, text)', 'execute') then
    raise exception '가드: 회비 RPC 가 익명에 노출됐습니다';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_dues_charge(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.report_dues_charge(uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_dues_charges(text, integer)', 'execute') then
    raise exception '가드: 회비 RPC 에 authenticated execute 가 빠졌습니다';
  end if;

  -- RLS 필수
  select count(*) into n from pg_class
   where relname = 'crew_dues_charges' and relnamespace='public'::regnamespace and relrowsecurity;
  if n <> 1 then raise exception '가드: crew_dues_charges 에 RLS 가 없습니다'; end if;
end $$;
