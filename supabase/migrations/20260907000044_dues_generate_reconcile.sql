-- ============================================================
-- Roxlogy — 월회비 청구 생성을 "대사(reconcile)"로
--
-- 문제 1. 등급의 월회비를 고친 뒤 다시 생성해도 이미 만들어진 미납 청구는
--   옛 금액 그대로였다. on conflict do nothing 이라 갱신 경로가 아예 없었다.
--   운영진 입장에선 "요금을 바꿨는데 반영이 안 되는" 것으로 보인다.
-- 문제 2. 등급을 월회비 없는 등급으로 옮긴 크루원의 청구가 남아 미납으로
--   계속 잡혔다.
-- 문제 3. 반환값이 생성 건수뿐이라 화면이 "0건"과 "아무 일도 안 함"을
--   구분해 알릴 수 없었다.
--
-- 이제 한 번 누르면 그 달을 현재 등급·요금 기준으로 맞춘다:
--   생성(없던 사람) · 갱신(금액/등급 바뀐 사람) · 회수(대상 아닌 사람).
-- 단 이미 확정(confirmed)됐거나 본인이 납부 신고(reported)한 청구는 건드리지
-- 않는다 — 확정은 회계 기록과 묶여 있고, 신고는 그 금액으로 냈다는 주장이다.
-- ============================================================

drop function if exists public.generate_monthly_charges(uuid, text);
create function public.generate_monthly_charges(p_crew uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_created int := 0;
  v_updated int := 0;
  v_removed int := 0;
  v_locked int := 0;
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'dues_bad_period'; end if;

  -- 1) 아직 청구가 없는 대상에게 생성
  insert into crew_dues_charges
    (crew_id, user_id, kind, label, amount, period, tier_id, created_by)
  select m.crew_id, m.user_id, 'monthly',
         p_period || ' ' || t.name || ' 월회비', t.monthly_fee, p_period, t.id, auth.uid()
  from crew_members m
  join crew_member_tiers t on t.id = m.tier_id
  where m.crew_id = p_crew and m.status = 'active' and t.monthly_fee is not null
  on conflict (crew_id, user_id, period) where kind = 'monthly' do nothing;
  get diagnostics v_created = row_count;

  -- 2) 미납(pending) 청구를 현재 등급·요금으로 갱신
  update crew_dues_charges ch
     set amount = t.monthly_fee,
         tier_id = t.id,
         label = p_period || ' ' || t.name || ' 월회비'
    from crew_members m
    join crew_member_tiers t on t.id = m.tier_id
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'monthly'
     and ch.status = 'pending'
     and m.crew_id = ch.crew_id and m.user_id = ch.user_id and m.status = 'active'
     and t.monthly_fee is not null
     and (ch.amount is distinct from t.monthly_fee or ch.tier_id is distinct from t.id);
  get diagnostics v_updated = row_count;

  -- 3) 더 이상 월회비 대상이 아닌 미납 청구는 회수 (등급 변경·탈퇴)
  delete from crew_dues_charges ch
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'monthly'
     and ch.status = 'pending'
     and not exists (
       select 1 from crew_members m
       join crew_member_tiers t on t.id = m.tier_id
       where m.crew_id = ch.crew_id and m.user_id = ch.user_id
         and m.status = 'active' and t.monthly_fee is not null);
  get diagnostics v_removed = row_count;

  -- 4) 손대지 않은 건 몇 건인지 알려준다 (확정·신고분)
  select count(*) into v_locked
    from crew_dues_charges ch
    join crew_members m on m.crew_id = ch.crew_id and m.user_id = ch.user_id
    join crew_member_tiers t on t.id = m.tier_id
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'monthly'
     and ch.status <> 'pending'
     and (ch.amount is distinct from t.monthly_fee);

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated,
    'removed', v_removed, 'locked', v_locked);
end;
$$;
grant execute on function public.generate_monthly_charges(uuid, text) to authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare
  v_crew uuid; v_owner uuid; v_target uuid; t_fee uuid; t_free uuid;
  j jsonb; v_amt int; v_conf int;
begin
  select id into v_crew from public.crews where slug = 'loop8';
  if v_crew is null then return; end if;
  select user_id into v_owner from public.crew_members
   where crew_id = v_crew and role = 'owner' limit 1;
  select id into t_fee from public.crew_member_tiers
   where crew_id = v_crew and monthly_fee is not null limit 1;
  select id into t_free from public.crew_member_tiers
   where crew_id = v_crew and monthly_fee is null limit 1;
  if v_owner is null or t_fee is null or t_free is null then return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  -- 확정된 청구는 절대 건드리면 안 된다
  select count(*) into v_conf from public.crew_dues_charges
   where crew_id = v_crew and kind = 'monthly' and status = 'confirmed';

  -- (a) 요금을 바꾸면 미납 청구가 따라와야 한다
  j := public.generate_monthly_charges(v_crew, '2099-01');
  update public.crew_member_tiers set monthly_fee = 12345 where id = t_fee;
  j := public.generate_monthly_charges(v_crew, '2099-01');
  select distinct amount into v_amt from public.crew_dues_charges
   where crew_id = v_crew and period = '2099-01' and kind = 'monthly' and tier_id = t_fee;
  if v_amt is distinct from 12345 then
    raise exception '가드: 요금 변경이 미납 청구에 반영되지 않습니다 (%)', v_amt;
  end if;
  if (j->>'updated')::int = 0 then
    raise exception '가드: 갱신 건수가 0으로 보고됩니다';
  end if;

  -- (b) 월회비 없는 등급으로 옮기면 미납 청구가 회수돼야 한다
  select user_id into v_target from public.crew_members
   where crew_id = v_crew and tier_id = t_fee and role <> 'owner' limit 1;
  if v_target is not null then
    perform set_config('rox.crew_role_bypass', '1', true);
    update public.crew_members set tier_id = t_free
     where crew_id = v_crew and user_id = v_target;
    j := public.generate_monthly_charges(v_crew, '2099-01');
    if (j->>'removed')::int = 0 then
      raise exception '가드: 대상이 아닌 미납 청구가 회수되지 않습니다';
    end if;
  end if;

  -- (c) 확정 청구는 그대로여야 한다
  if (select count(*) from public.crew_dues_charges
       where crew_id = v_crew and kind = 'monthly' and status = 'confirmed') <> v_conf then
    raise exception '가드: 확정된 청구가 변경됐습니다';
  end if;

  -- 테스트로 만든 미래 기간 청구 제거
  delete from public.crew_dues_charges where crew_id = v_crew and period = '2099-01';
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
