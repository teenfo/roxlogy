-- ============================================================
-- Roxlogy — 출석 명단에 계정 주소
--
-- 모임 출석 체크에서 동명이인을 가릴 수 없어 이메일을 함께 표시한다.
-- 이메일은 개인정보라 운영진·관리자에게만 내린다 — 일반 크루원에게는
-- 명단은 보이되 email 이 null 로 온다 (crew_manage_roster 와 같은 원칙).
-- ============================================================

drop function if exists public.crew_event_attendance(uuid);
create function public.crew_event_attendance(p_event uuid)
returns table(
  user_id uuid, display_name text, email text, role text,
  rsvp_status text, checked_in boolean
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id,
         coalesce(p.display_name, 'Athlete'),
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then u.email::text else null end,
         m.role,
         r.status,
         r.checked_in_at is not null
  from crew_events e
  join crew_members m on m.crew_id = e.crew_id and m.status = 'active'
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_event_rsvps r on r.event_id = e.id and r.user_id = m.user_id
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
declare n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_event_attendance'
    and a.nm = 'email';
  if n <> 1 then raise exception '가드: 출석 명단에 email 출력 컬럼이 없습니다'; end if;

  -- 이메일은 스태프 게이트를 통과한 경우에만 나가야 한다
  if not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_event_attendance'
      and p.prosecdef and pg_get_functiondef(p.oid) like '%is_crew_staff(e.crew_id)%'
  ) then
    raise exception '가드: 출석 명단 이메일에 스태프 게이트가 없습니다';
  end if;

  if has_function_privilege('anon', 'public.crew_event_attendance(uuid)', 'execute') then
    raise exception '가드: 출석 명단이 익명에 노출됐습니다';
  end if;
end $$;
