-- ============================================================
-- Roxlogy — 크루원 통계 (운영진 관리 화면용)
--
-- 관리 화면이 나열식이라 크루 상태를 한눈에 볼 수 없었다. 운영진이
-- 실제로 궁금해하는 숫자만 한 번에 내려준다: 인원·등급 분포·최근 30일
-- 활동(모임·출석·훈련)·미납.
-- 스태프가 아니면 행 자체를 돌려주지 않는다(=null).
-- 날짜 판정은 KST(app_today) 기준.
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
    'unpaid_amount', coalesce((select sum(ch.amount) from crew_dues_charges ch, c
                                where ch.crew_id = c.id and ch.status <> 'confirmed'), 0),
    'unpaid_count', (select count(*) from crew_dues_charges ch, c
                      where ch.crew_id = c.id and ch.status <> 'confirmed')
  )
  from c;
$$;
grant execute on function public.crew_member_stats(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.crew_member_stats(text)', 'execute') then
    raise exception '가드: 통계 RPC 가 익명에 노출됐습니다';
  end if;
  if not has_function_privilege('authenticated', 'public.crew_member_stats(text)', 'execute') then
    raise exception '가드: 통계 RPC 에 execute 가 빠졌습니다';
  end if;
end $$;
