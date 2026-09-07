-- ============================================================
-- Roxlogy — 회차비 대사(reconcile)
--
-- 월회비와 같은 문제가 회차비에도 있다. 출석 체크 순간에 자동 청구되지만,
-- 그 뒤에 사정이 바뀌어도 따라가지 않는다:
--   · 등급의 회차비를 나중에 정했거나 고쳤다 → 옛 금액 그대로
--   · 크루원 등급을 바꿨다 → 옛 등급 요금 그대로
--   · 모임을 취소했다 → 청구가 남아 미납으로 잡힌다
--   · 회차비를 뒤늦게 설정했다 → 그 전 출석분은 청구 자체가 없다
--
-- 기준은 "출석 체크(checked_in_at)". 취소되지 않은 모임에 출석 체크가 남아
-- 있고, 그 크루원의 현재 등급에 회차비가 있으면 청구가 있어야 한다.
-- 월회비와 같이 확정(confirmed)·신고(reported)된 청구는 건드리지 않는다.
-- ============================================================

create or replace function public.generate_session_charges(p_crew uuid, p_period text)
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

  -- 1) 출석했는데 청구가 없는 건 생성
  insert into crew_dues_charges
    (crew_id, user_id, kind, label, amount, period, event_id, tier_id, created_by)
  select e.crew_id, r.user_id, 'session', left(e.title, 120), t.session_fee,
         p_period, e.id, t.id, auth.uid()
  from crew_events e
  join crew_event_rsvps r on r.event_id = e.id and r.checked_in_at is not null
  join crew_members m on m.crew_id = e.crew_id and m.user_id = r.user_id
                     and m.status = 'active'
  join crew_member_tiers t on t.id = m.tier_id
  where e.crew_id = p_crew
    and e.cancelled_at is null
    and to_char(e.starts_at at time zone 'Asia/Seoul', 'YYYY-MM') = p_period
    and t.session_fee is not null
  on conflict (crew_id, user_id, event_id) where kind = 'session' do nothing;
  get diagnostics v_created = row_count;

  -- 2) 미납 청구를 현재 등급 요금·모임 제목으로 갱신
  update crew_dues_charges ch
     set amount = t.session_fee,
         tier_id = t.id,
         label = left(e.title, 120)
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

  -- 3) 근거가 사라진 미납 청구 회수 (출석 취소·모임 취소·탈퇴·요금 없는 등급)
  delete from crew_dues_charges ch
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status = 'pending'
     and not exists (
       select 1
       from crew_events e
       join crew_event_rsvps r on r.event_id = e.id and r.user_id = ch.user_id
                              and r.checked_in_at is not null
       join crew_members m on m.crew_id = e.crew_id and m.user_id = ch.user_id
                          and m.status = 'active'
       join crew_member_tiers t on t.id = m.tier_id and t.session_fee is not null
       where e.id = ch.event_id and e.cancelled_at is null);
  get diagnostics v_removed = row_count;

  -- 4) 확정·신고분 중 현재 요금과 어긋난 건수 (알림용, 손대지 않는다)
  select count(*) into v_locked
    from crew_dues_charges ch
    join crew_members m on m.crew_id = ch.crew_id and m.user_id = ch.user_id
    join crew_member_tiers t on t.id = m.tier_id
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status <> 'pending'
     and ch.amount is distinct from t.session_fee;

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated,
    'removed', v_removed, 'locked', v_locked);
end;
$$;
grant execute on function public.generate_session_charges(uuid, text) to authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare
  v_crew uuid; v_owner uuid; v_ev uuid; v_period text; v_member uuid;
  t_fee uuid; j jsonb; v_amt int; v_conf int; n int;
begin
  select id into v_crew from public.crews where slug = 'loop8';
  if v_crew is null then return; end if;
  select user_id into v_owner from public.crew_members
   where crew_id = v_crew and role = 'owner' limit 1;
  select e.id, to_char(e.starts_at at time zone 'Asia/Seoul', 'YYYY-MM')
    into v_ev, v_period
   from public.crew_events e
   where e.crew_id = v_crew and e.cancelled_at is null
   order by e.starts_at desc limit 1;
  select id into t_fee from public.crew_member_tiers
   where crew_id = v_crew and session_fee is not null limit 1;
  if v_owner is null or v_ev is null or t_fee is null then return; end if;

  select m.user_id into v_member from public.crew_members m
   where m.crew_id = v_crew and m.tier_id = t_fee and m.status = 'active' limit 1;
  if v_member is null then return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  select count(*) into v_conf from public.crew_dues_charges
   where crew_id = v_crew and kind = 'session' and status = 'confirmed';

  -- (a) 출석은 있는데 청구가 없으면 만들어야 한다
  insert into public.crew_event_rsvps(event_id, user_id, status, checked_in_at)
  values (v_ev, v_member, 'going', now())
  on conflict (event_id, user_id) do update set checked_in_at = now();
  delete from public.crew_dues_charges
   where event_id = v_ev and user_id = v_member and kind = 'session' and status = 'pending';
  j := public.generate_session_charges(v_crew, v_period);
  select count(*) into n from public.crew_dues_charges
   where event_id = v_ev and user_id = v_member and kind = 'session';
  if n = 0 then raise exception '가드: 출석분 회차비가 생성되지 않습니다 (%)', j::text; end if;

  -- (b) 요금을 바꾸면 미납 청구가 따라와야 한다
  update public.crew_member_tiers set session_fee = 54321 where id = t_fee;
  j := public.generate_session_charges(v_crew, v_period);
  select amount into v_amt from public.crew_dues_charges
   where event_id = v_ev and user_id = v_member and kind = 'session' and status = 'pending';
  if v_amt is distinct from 54321 then
    raise exception '가드: 회차비 변경이 미납 청구에 반영되지 않습니다 (%)', v_amt;
  end if;

  -- (c) 출석을 취소하면 미납 청구가 회수돼야 한다
  update public.crew_event_rsvps set checked_in_at = null
   where event_id = v_ev and user_id = v_member;
  j := public.generate_session_charges(v_crew, v_period);
  select count(*) into n from public.crew_dues_charges
   where event_id = v_ev and user_id = v_member and kind = 'session' and status = 'pending';
  if n <> 0 then raise exception '가드: 출석 취소분 청구가 남아 있습니다'; end if;

  -- (d) 확정 청구는 그대로여야 한다
  if (select count(*) from public.crew_dues_charges
       where crew_id = v_crew and kind = 'session' and status = 'confirmed') <> v_conf then
    raise exception '가드: 확정된 회차비 청구가 변경됐습니다';
  end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
