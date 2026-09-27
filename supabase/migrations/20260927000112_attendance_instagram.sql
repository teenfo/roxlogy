-- ============================================================
-- Roxlogy — 출석 명단에 인스타 핸들
--
-- 모임 사진에 태그할 사람을 **고르고** 복사하려면 명단 행마다 핸들이 있어야
-- 한다(누가 등록했는지도 보여야 한다). 그동안은 누를 때 crew_event_instagrams
-- 로 출석자 핸들만 따로 가져왔는데, 대상을 고르는 UI 는 명단과 같은 행을
-- 봐야 하므로 crew_event_attendance 에 컬럼 하나를 덧붙인다.
--
-- 노출 범위는 그대로다 — 이 함수는 크루원에게만 행을 내리고(비회원은 0행),
-- 핸들은 공개 프로필(public_profile)에도 나가는 값이다.
--
-- 반환 모양이 바뀌므로 drop·재생성. 컬럼 **추가**라 옛 번들은 무시하고
-- 지나간다(CLAUDE.md "덧붙였다가 나중에 걷어내기"). crew_event_instagrams 는
-- 옛 번들의 복사 버튼이 아직 부르므로 남겨 두고, 다음 정리 때 드롭한다.
-- ============================================================

drop function if exists public.crew_event_attendance(uuid);
create function public.crew_event_attendance(p_event uuid)
returns table(
  user_id uuid, display_name text, email text, role text,
  rsvp_status text, checked_in boolean,
  charge_id uuid, charge_amount int, charge_status text,
  instagram text
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
              then ch.status end,
         nullif(p.instagram, '')
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
    and a.nm in ('charge_id', 'charge_amount', 'charge_status', 'instagram');
  if n <> 4 then raise exception '가드: 출석 명단 컬럼이 빠졌습니다 (%)', n; end if;

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
