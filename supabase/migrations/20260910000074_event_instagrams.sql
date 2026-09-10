-- 출석한 사람들의 인스타그램 핸들 — 모임 후 사진에 태그할 때 쓴다.
--
-- crew_event_attendance 에 컬럼을 더하면 반환 모양이 바뀌어 drop·재생성이
-- 필요하고, 이 목록은 "복사" 버튼을 누를 때만 쓰이므로 별도 함수로 둔다.
-- 크루원에게만 내려간다 — 핸들은 프로필에 적어 둔 값이지만, 누가 어느 모임에
-- 나왔는지와 묶이는 순간 크루 안의 정보가 된다.
create or replace function public.crew_event_instagrams(p_event uuid)
returns table(display_name text, instagram text)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.display_name, 'Athlete'), nullif(p.instagram, '')
    from crew_events e
    join crew_event_rsvps r
      on r.event_id = e.id and r.checked_in_at is not null
    join profiles p on p.id = r.user_id
   where e.id = p_event
     and e.cancelled_at is null
     and (select is_crew_member(e.crew_id))
   order by coalesce(p.display_name, 'Athlete');
$$;

grant execute on function public.crew_event_instagrams(uuid) to anon, authenticated;

-- 검증 — 비로그인·비회원에게는 아무것도 내려가지 않는다
do $$
declare
  v_event uuid;
  v_member uuid;
  v_out uuid;
  v_crew uuid;
  v_n int;
begin
  select r.event_id into v_event
    from crew_event_rsvps r
   where r.checked_in_at is not null
   group by r.event_id order by count(*) desc limit 1;
  if v_event is null then
    raise notice 'no checked-in rsvps — skipping guard';
    return;
  end if;
  select e.crew_id into v_crew from crew_events e where e.id = v_event;
  select m.user_id into v_member from crew_members m
   where m.crew_id = v_crew and m.status = 'active' limit 1;

  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from crew_event_instagrams(v_event);
  if v_n <> 0 then raise exception 'anon sees % rows', v_n; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from crew_event_instagrams(v_event);
  if v_n = 0 then raise exception 'crew member sees no rows'; end if;

  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m
                      where m.crew_id = v_crew and m.user_id = p.id
                        and m.status = 'active')
     and not coalesce(p.is_admin, false)
   limit 1;
  if v_out is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
    select count(*) into v_n from crew_event_instagrams(v_event);
    if v_n <> 0 then raise exception 'outsider sees % rows', v_n; end if;
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;
