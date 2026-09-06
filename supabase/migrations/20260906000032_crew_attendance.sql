-- ============================================================
-- Roxlogy — 모임 출석 체크
--
-- crew_event_rsvps.checked_in_at 은 처음부터 있던 컬럼인데 아무도 쓰지
-- 않았다. 여기서 실제 기능으로 연결한다:
--   1) crew_event_check_in()  — 운영진이 모임별로 출석/취소 (RSVP 안 한
--      워크인도 체크 가능 — 없으면 참석 행을 만든다)
--   2) crew_event_attendance() — 모임 출석 명단 (크루원 조회)
--   3) crew_roster() 에 attend_count 추가 — 크루원별 누적 출석 횟수
--      (크루 내부 활동이라 크루원에게만 숫자를 돌려준다)
-- RSVP(참석하겠다)와 출석(실제로 왔다)은 별개다. 출석 판정은 오직
-- checked_in_at 으로 하며 RSVP 상태는 건드리지 않는다.
-- ============================================================

-- 출석 조회를 위한 인덱스 — 크루원별 누적 집계가 rsvps 전체를 훑지 않도록
create index if not exists crew_event_rsvps_checked_in_idx
  on public.crew_event_rsvps(user_id, event_id) where checked_in_at is not null;

-- 1) 출석 체크 (운영진 전용) --------------------------------------------------
create or replace function public.crew_event_check_in(
  p_event uuid, p_user uuid, p_present boolean
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select crew_id into v_crew from crew_events
   where id = p_event and cancelled_at is null;
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
    -- RSVP 를 안 한 워크인도 체크할 수 있게 참석 행을 만든다.
    -- 정원이 찼으면 capacity guard 가 waitlisted 로 돌리지만, 출석 판정은
    -- checked_in_at 으로만 하므로 집계에는 영향이 없다.
    insert into crew_event_rsvps(event_id, user_id, status, checked_in_at)
    values (p_event, p_user, 'going', now())
    on conflict (event_id, user_id) do update set checked_in_at = now();
  else
    update crew_event_rsvps set checked_in_at = null
     where event_id = p_event and user_id = p_user;
  end if;
end;
$$;
grant execute on function public.crew_event_check_in(uuid, uuid, boolean) to authenticated;

-- 2) 모임 출석 명단 (크루원 조회) ---------------------------------------------
drop function if exists public.crew_event_attendance(uuid);
create function public.crew_event_attendance(p_event uuid)
returns table(
  user_id uuid, display_name text, role text,
  rsvp_status text, checked_in boolean
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id,
         coalesce(p.display_name, 'Athlete'),
         m.role,
         r.status,
         r.checked_in_at is not null
  from crew_events e
  join crew_members m on m.crew_id = e.crew_id and m.status = 'active'
  join profiles p on p.id = m.user_id
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

-- 3) 크루원 명단에 누적 출석 횟수 --------------------------------------------
-- 반환 컬럼이 늘어나므로 drop 후 재정의.
drop function if exists public.crew_roster(text, integer);
create function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(
  user_id uuid, display_name text, division text, role text,
  joined_at timestamptz, session_count bigint, attend_count bigint
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), p.division, m.role, m.joined_at,
         (select count(*) from sessions s
            where s.user_id = m.user_id and s.deleted_at is null),
         -- 출석은 크루 내부 활동 — 공개 크루라도 비회원에게는 내리지 않는다
         case when (select is_crew_member(c.id)) or (select is_admin()) then
           (select count(*) from crew_event_rsvps r
              join crew_events e on e.id = r.event_id
             where r.user_id = m.user_id
               and e.crew_id = c.id
               and e.cancelled_at is null
               and r.checked_in_at is not null)
         else null::bigint end
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  where c.slug = p_slug and m.status = 'active'
    and (c.is_public or (select is_crew_member(c.id)))
  order by case m.role when 'owner' then 0 when 'coach' then 1 else 2 end, m.joined_at
  limit least(p_limit, 500);
$$;
grant execute on function public.crew_roster(text, integer) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare n int;
begin
  -- 명단에 attend_count 가 있어야 한다
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_roster'
    and a.nm = 'attend_count';
  if n <> 1 then raise exception '가드: crew_roster 에 attend_count 가 없습니다'; end if;

  -- 클라이언트가 부를 RPC 3종은 execute 가 있어야 한다 (기본 차단 정책 때문)
  if not has_function_privilege('authenticated', 'public.crew_event_check_in(uuid, uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.crew_event_attendance(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.crew_roster(text, integer)', 'execute') then
    raise exception '가드: 출석 RPC 에 authenticated execute 가 빠졌습니다';
  end if;

  -- 쓰기(출석 체크)는 익명에게 열려 있으면 안 된다
  if has_function_privilege('anon', 'public.crew_event_check_in(uuid, uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.crew_event_attendance(uuid)', 'execute') then
    raise exception '가드: 출석 RPC 가 익명에 노출됐습니다';
  end if;
end $$;
