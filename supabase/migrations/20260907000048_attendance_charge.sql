-- ============================================================
-- Roxlogy — 출석 명단에 그 모임의 회차비 청구 상태
--
-- 회차비는 출석 체크에서 생기는데 확정은 회계 탭에서 해야 해서, 운영진이
-- 모임 현장에서 돈을 받고도 화면을 옮겨야 했다. 출석 체크 옆에서 바로
-- 확정할 수 있게 명단에 그 사람의 회차비 청구를 함께 내려준다.
--
-- 금액·상태는 개인 회비 정보라 이메일과 같이 운영진에게만 내린다.
-- (일반 크루원의 읽기 전용 명단에는 null 로 간다)
-- ============================================================

drop function if exists public.crew_event_attendance(uuid);
create function public.crew_event_attendance(p_event uuid)
returns table(
  user_id uuid, display_name text, email text, role text,
  rsvp_status text, checked_in boolean,
  charge_id uuid, charge_amount int, charge_status text
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id,
         coalesce(p.display_name, 'Athlete'),
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then u.email::text else null end,
         m.role,
         r.status,
         r.checked_in_at is not null,
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then ch.id end,
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then ch.amount end,
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then ch.status end
  from crew_events e
  join crew_members m on m.crew_id = e.crew_id and m.status = 'active'
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_event_rsvps r on r.event_id = e.id and r.user_id = m.user_id
  left join crew_dues_charges ch on ch.event_id = e.id and ch.user_id = m.user_id
                                and ch.kind = 'session'
  where e.id = p_event
    and e.cancelled_at is null
    and ((select is_crew_member(e.crew_id)) or (select is_admin()))
  order by (r.checked_in_at is null),
           case coalesce(r.status, '')
             when 'going' then 0 when 'waitlisted' then 1
             when 'maybe' then 2 when 'declined' then 4 else 3 end,
           coalesce(p.display_name, 'Athlete');
$$;
grant execute on function public.crew_event_attendance(uuid) to authenticated;

do $$
declare v_def text; n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_event_attendance'
    and a.nm in ('charge_id', 'charge_amount', 'charge_status');
  if n <> 3 then raise exception '가드: 출석 명단에 청구 컬럼이 없습니다 (%)', n; end if;

  -- 이메일·금액·상태 네 곳 모두 스태프 게이트를 지나야 한다
  select pg_get_functiondef(oid) into v_def from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'crew_event_attendance';
  select count(*) into n from regexp_matches(v_def, 'is_crew_staff\(e\.crew_id\)', 'g');
  if n < 4 then
    raise exception '가드: 이메일·금액·상태에 스태프 게이트가 부족합니다 (%)', n;
  end if;

  if has_function_privilege('anon', 'public.crew_event_attendance(uuid)', 'execute') then
    raise exception '가드: 출석 명단이 익명에 노출됐습니다';
  end if;
end $$;
