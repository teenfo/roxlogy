-- ============================================================
-- Roxlogy — MCP: 운영진이 크루원의 모임 참석 여부를 지정 (2026-10-03)
--
-- 그동안 MCP 의 rsvp_meetup 은 본인 응답만 바꿨다. 운영진(리더·부리더)이 카톡 등으로 받은
-- 응답을 대신 넣을 수 있게, 크루원 여러 명의 참석(going)·미정(maybe)·불참(declined)을
-- 한 번에 지정한다. 응답 자체를 없애는 기능은 두지 않는다(출석·회차비 근거가 되는 행이라).
--   _crew_set_rsvps(crew, event, users[], status) — 본체. 내부용(grant 없음)
--   mcp_set_member_rsvp(token, slug, event, users[], status) — mcp_staff_crew 로 운영진·쓰기 토큰 판정
-- 규칙은 본인 응답과 같다: 취소된 모임 불가, 정회원 전용 모임에 준회원(associate) 불가,
-- 정원이 차면 going 은 트리거가 waitlisted(대기)로 돌린다. 종료된 모임은 운영진이라 허용
-- (RLS 도 운영진의 수정은 종료 여부와 무관하게 허용한다).
-- 출석 체크는 응답 상태와 따로다(check_in_member) — 상태를 바꿔도 checked_in_at 은 그대로.
-- 신설만 — 배포 순서 무관. 되돌리기: 두 함수를 없앤다.
-- ============================================================

create or replace function public._crew_set_rsvps(p_crew uuid, p_event uuid, p_users uuid[], p_status text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_ev record; v_uid uuid; v_role text; v_stored text;
  v_res jsonb := '[]'::jsonb;
begin
  if p_status not in ('going', 'maybe', 'declined') then
    return jsonb_build_object('error', 'invalid_status');
  end if;
  if coalesce(cardinality(p_users), 0) = 0 then return jsonb_build_object('error', 'no_users'); end if;
  if cardinality(p_users) > 100 then return jsonb_build_object('error', 'too_many_users'); end if;
  select id, title, members_only, cancelled_at, capacity into v_ev
    from crew_events where id = p_event and crew_id = p_crew;
  if v_ev.id is null then return jsonb_build_object('error', 'event_not_found'); end if;
  if v_ev.cancelled_at is not null then return jsonb_build_object('error', 'event_cancelled'); end if;

  foreach v_uid in array (select array_agg(distinct u) from unnest(p_users) u) loop
    select m.role into v_role from crew_members m
     where m.crew_id = p_crew and m.user_id = v_uid and m.status = 'active';
    if v_role is null then
      v_res := v_res || jsonb_build_object('user_id', v_uid, 'error', 'not_a_member');
      continue;
    end if;
    if p_status <> 'declined' and v_ev.members_only and v_role = 'associate' then
      v_res := v_res || jsonb_build_object('user_id', v_uid, 'error', 'members_only');
      continue;
    end if;
    insert into crew_event_rsvps (event_id, user_id, status)
    values (p_event, v_uid, p_status)
    on conflict (event_id, user_id) do update set status = excluded.status;
    select status into v_stored from crew_event_rsvps where event_id = p_event and user_id = v_uid;
    v_res := v_res || jsonb_build_object(
      'user_id', v_uid,
      'name', (select coalesce(nullif(display_name, ''), 'Athlete') from profiles where id = v_uid),
      'status', v_stored);
  end loop;

  return jsonb_build_object('ok', true, 'event', v_ev.title, 'results', v_res,
    'going_count', (select count(*) from crew_event_rsvps r where r.event_id = p_event and r.status = 'going'),
    'capacity', v_ev.capacity);
end; $$;

create or replace function public.mcp_set_member_rsvp(p_token text, p_slug text, p_event uuid,
                                                     p_user_ids uuid[], p_status text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug);
begin
  if v_crew is null then return null; end if;
  return _crew_set_rsvps(v_crew, p_event, p_user_ids, p_status);
end; $$;
grant execute on function public.mcp_set_member_rsvp(text, text, uuid, uuid[], text) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 본체는 클라이언트가 못 부르고, 지정·크루 밖 거부·정원 대기·승격이 동작하는지 — 확인 후 되감는다.
do $$
declare v_ev uuid; v_crew uuid; v_a uuid; v_b uuid; v_out uuid; j jsonb;
begin
  if has_function_privilege('anon', 'public._crew_set_rsvps(uuid, uuid, uuid[], text)', 'execute')
     or has_function_privilege('authenticated', 'public._crew_set_rsvps(uuid, uuid, uuid[], text)', 'execute') then
    raise exception '가드: 참석 지정 본체가 클라이언트에 열려 있습니다';
  end if;
  if not has_function_privilege('anon', 'public.mcp_set_member_rsvp(text, text, uuid, uuid[], text)', 'execute') then
    raise exception '가드: MCP 참석 지정에 실행 권한이 없습니다';
  end if;
  select e.id, e.crew_id into v_ev, v_crew from crew_events e
   where e.cancelled_at is null
     and (select count(*) from crew_members m where m.crew_id = e.crew_id and m.status = 'active') >= 2
   order by e.starts_at desc limit 1;
  if v_ev is null then raise notice '가드 건너뜀: 모임 없음'; return; end if;
  select m.user_id into v_a from crew_members m where m.crew_id = v_crew and m.status = 'active' order by m.user_id limit 1;
  select m.user_id into v_b from crew_members m where m.crew_id = v_crew and m.status = 'active' and m.user_id <> v_a order by m.user_id limit 1;
  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id) limit 1;

  begin
    update crew_events set capacity = null, members_only = false, closed_at = null where id = v_ev;
    -- 앞선 대기자가 있으면 B 대신 승격되므로 비워 둔다(되감긴다)
    update crew_event_rsvps set status = 'maybe' where event_id = v_ev and status = 'waitlisted';

    j := _crew_set_rsvps(v_crew, v_ev, array[v_a, v_b, v_out], 'maybe');
    if (select count(*) from crew_event_rsvps where event_id = v_ev and user_id in (v_a, v_b) and status = 'maybe') <> 2 then
      raise exception '가드: 미정 지정 실패 %', j;
    end if;
    if v_out is not null and not exists (select 1 from jsonb_array_elements(j->'results') x
                                          where x->>'user_id' = v_out::text and x->>'error' = 'not_a_member') then
      raise exception '가드: 크루 밖 사람이 걸러지지 않음 %', j;
    end if;

    -- 정원 = 지금 참석 인원 + 1 — A 가 마지막 자리를 받고 B 는 대기
    update crew_events set capacity = 1 + (select count(*) from crew_event_rsvps
                                           where event_id = v_ev and status = 'going') where id = v_ev;
    j := _crew_set_rsvps(v_crew, v_ev, array[v_a], 'going');
    j := _crew_set_rsvps(v_crew, v_ev, array[v_b], 'going');
    if (select status from crew_event_rsvps where event_id = v_ev and user_id = v_b) <> 'waitlisted' then
      raise exception '가드: 정원 초과가 대기로 가지 않음 %', j;
    end if;
    j := _crew_set_rsvps(v_crew, v_ev, array[v_a], 'declined');
    if (select status from crew_event_rsvps where event_id = v_ev and user_id = v_b) <> 'going' then
      raise exception '가드: 불참 지정 뒤 대기자 승격 안 됨 %', j;
    end if;

    j := _crew_set_rsvps(v_crew, v_ev, array[v_a], 'yes');
    if j->>'error' is distinct from 'invalid_status' then raise exception '가드: 잘못된 상태 통과 %', j; end if;

    raise exception 'guard_ok';
  exception when raise_exception then
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
