-- ============================================================
-- Roxlogy — 크루원 통계의 "미납 회비"에서 면제분 제외 (버그 수정)
--
-- crew_member_stats 는 미납을 "확정이 아닌 것 전부" 로 세고 있었다. 나중에
-- 'waived'(면제) 상태를 추가하면서 여기를 같이 고치지 않아 면제한 금액이
-- 미납으로 잡혔다. loop8 에서 면제 4건 20,000원이 그대로 미납으로 표시된 것이
-- 이 문제였다 (실제 미납은 0원).
--
-- 미납 = pending + reported. 면제는 waived_amount 로 따로 내려, 화면에서
-- "청구 N건 · 면제 ₩X" 로 함께 보여준다.
-- ============================================================

create or replace function public.crew_member_stats(p_slug text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select id from crews
     where slug = p_slug and ((select is_crew_staff(id)) or (select is_admin()))
  ),
  win as (select (app_today() - 29)::date as from_d, app_today() as to_d),
  ev as (
    select e.id from crew_events e, c, win w
     where e.crew_id = c.id and e.cancelled_at is null
       and (e.starts_at at time zone 'Asia/Seoul')::date between w.from_d and w.to_d
  )
  select jsonb_build_object(
    'members', (select count(*) from crew_members m, c
                 where m.crew_id = c.id and m.status = 'active'),
    'pending', (select count(*) from crew_members m, c
                 where m.crew_id = c.id and m.status = 'pending'),
    'joined_30d', (select count(*) from crew_members m, c, win w
                    where m.crew_id = c.id and m.status = 'active'
                      and (m.joined_at at time zone 'Asia/Seoul')::date >= w.from_d),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color, 'count', x.n)
                       order by t.sort_order, t.name)
      from crew_member_tiers t
      join c on c.id = t.crew_id
      join lateral (
        select count(*) as n from crew_members m
         where m.tier_id = t.id and m.status = 'active'
      ) x on true
      where t.archived_at is null or x.n > 0), '[]'::jsonb),
    'meetups_30d', (select count(*) from ev),
    'attend_30d', (select count(*) from crew_event_rsvps r
                    where r.event_id in (select id from ev) and r.checked_in_at is not null),
    'attenders_30d', (select count(distinct r.user_id) from crew_event_rsvps r
                       where r.event_id in (select id from ev) and r.checked_in_at is not null),
    'trained_30d', (select count(distinct s.user_id)
                     from sessions s
                     join crew_members m on m.user_id = s.user_id and m.status = 'active'
                     join c on c.id = m.crew_id, win w
                     where s.deleted_at is null
                       and (s.started_at at time zone 'Asia/Seoul')::date between w.from_d and w.to_d),
    -- 면제(waived)는 낼 돈이 아니다. "확정이 아닌 것 전부" 로 세면 면제분까지
    -- 미납에 들어간다 — waived 상태를 나중에 추가하면서 여기가 빠져 있었다.
    'unpaid_amount', coalesce((select sum(ch.amount) from crew_dues_charges ch, c
                                where ch.crew_id = c.id
                                  and ch.status in ('pending', 'reported')), 0),
    'unpaid_count', (select count(*) from crew_dues_charges ch, c
                      where ch.crew_id = c.id
                        and ch.status in ('pending', 'reported')),
    'waived_amount', coalesce((select sum(ch.amount) from crew_dues_charges ch, c
                                where ch.crew_id = c.id and ch.status = 'waived'), 0)
  )
  from c;
$$;
grant execute on function public.crew_member_stats(text) to authenticated;

do $$
declare v_crew uuid; v_owner uuid; j jsonb; w bigint; u bigint;
begin
  select id into v_crew from public.crews where slug = 'loop8';
  if v_crew is null then return; end if;
  select user_id into v_owner from public.crew_members
   where crew_id = v_crew and role = 'owner' limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  j := public.crew_member_stats('loop8');
  select coalesce(sum(amount), 0) into w from public.crew_dues_charges
   where crew_id = v_crew and status = 'waived';
  select coalesce(sum(amount), 0) into u from public.crew_dues_charges
   where crew_id = v_crew and status in ('pending', 'reported');
  if (j->>'unpaid_amount')::bigint <> u or (j->>'waived_amount')::bigint <> w then
    raise exception '가드: 미납/면제 집계가 맞지 않습니다 (미납 % vs %, 면제 % vs %)',
      j->>'unpaid_amount', u, j->>'waived_amount', w;
  end if;
  perform set_config('request.jwt.claims', '', true);
end $$;
