-- ============================================================
-- Roxlogy — 참석자 명단에 멤버 등급 뱃지
--
-- 이름만 내려주던 going_names text[] 를 going jsonb ({name, tier, color}) 로
-- 바꾼다. 반환 타입이 바뀌므로 먼저 드롭해야 한다.
--
-- 등급은 크루 내부 정보라 크루원에게만 채운다 — 공개 크루의 모임은 익명도 볼 수
-- 있는데(공유 링크) 거기까지 "게스트/정회원" 구분을 흘릴 이유가 없다. 이름은
-- 지금도 공개되므로 그대로 두고, tier·color 만 null 로 비운다.
--
-- 미정(maybe)·불참(declined)은 화면에서 인원수·쉼표 나열이라 손대지 않는다.
-- ============================================================

drop function if exists public.crew_event_detail(uuid);

create or replace function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going jsonb, maybe_names text[], declined_names text[],
  my_status text, is_staff boolean, comments_allowed boolean, comments jsonb,
  waitlist_names text[], fee_exempt boolean, members_only boolean,
  closed_at timestamptz)
language sql stable security definer set search_path to 'public' as $function$
  select e.id, c.slug, e.title, e.description, e.kind,
         e.starts_at, e.ends_at, e.location, e.capacity,
         coalesce((select jsonb_agg(jsonb_build_object(
              'name', coalesce(pr.display_name, 'Athlete'),
              -- 등급은 크루원에게만
              'tier', case when is_crew_member(e.crew_id) then ti.name end,
              'color', case when is_crew_member(e.crew_id) then ti.color end)
              order by r.created_at)
            from crew_event_rsvps r
            join profiles pr on pr.id = r.user_id
            left join crew_members m
              on m.crew_id = e.crew_id and m.user_id = r.user_id
                 and m.status = 'active'
            left join crew_member_tiers ti on ti.id = m.tier_id
            where r.event_id = e.id and r.status = 'going'), '[]'::jsonb),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'maybe'), '{}'),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'declined'), '{}'),
         (select r.status from crew_event_rsvps r
            where r.event_id = e.id and r.user_id = auth.uid()),
         is_crew_staff(e.crew_id),
         e.comments_allowed,
         coalesce((select jsonb_agg(jsonb_build_object(
              'id', cm.id, 'author_id', cm.author_id,
              'author_name', coalesce(pr2.display_name, 'Athlete'),
              'body', cm.body, 'created_at', cm.created_at)
              order by cm.created_at)
            from crew_event_comments cm
            join profiles pr2 on pr2.id = cm.author_id
            where cm.event_id = e.id and cm.deleted_at is null), '[]'::jsonb),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete')
              order by r.queued_at nulls first, r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'waitlisted'), '{}'),
         e.fee_exempt, e.members_only, e.closed_at
  from crew_events e
  join crews c on c.id = e.crew_id
  where e.id = p_event
    and e.cancelled_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not e.members_only or is_crew_full_member(e.crew_id));
$function$;

grant execute on function public.crew_event_detail(uuid) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $guard$
declare
  v_ev uuid; v_uid uuid; r record; v_going jsonb; v_n int;
begin
  select e.id into v_ev
    from crew_events e join crews c on c.id = e.crew_id
   where c.is_public and not e.members_only and e.cancelled_at is null
     and exists (select 1 from crew_event_rsvps x
                  where x.event_id = e.id and x.status = 'going')
   order by e.starts_at desc limit 1;
  if v_ev is null then return; end if;

  select m.user_id into v_uid from crew_members m
   join crew_events e on e.crew_id = m.crew_id
   where e.id = v_ev and m.status = 'active' limit 1;

  -- 익명: 이름은 보이되 등급은 비어야 한다
  perform set_config('request.jwt.claims', '', true);
  select * into r from crew_event_detail(v_ev);
  v_going := r.going;
  if jsonb_typeof(v_going) <> 'array' or jsonb_array_length(v_going) = 0 then
    raise exception '가드: 익명에게 참석 명단이 비었습니다';
  end if;
  if exists (select 1 from jsonb_array_elements(v_going) x
              where x->>'name' is null) then
    raise exception '가드: 참석자 이름이 비었습니다';
  end if;
  if exists (select 1 from jsonb_array_elements(v_going) x
              where x->>'tier' is not null) then
    raise exception '가드: 익명에게 등급이 새어 나갑니다';
  end if;
  v_n := jsonb_array_length(v_going);

  -- 크루원: 같은 인원수 + 등급이 채워져야 한다
  if v_uid is not null then
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_uid)::text, true);
    select * into r from crew_event_detail(v_ev);
    if jsonb_array_length(r.going) <> v_n then
      raise exception '가드: 크루원과 익명의 참석 인원수가 다릅니다 (% vs %)',
        jsonb_array_length(r.going), v_n;
    end if;
    if not exists (select 1 from jsonb_array_elements(r.going) x
                    where x->>'tier' is not null) then
      raise exception '가드: 크루원인데 등급이 하나도 안 채워졌습니다';
    end if;
  end if;
end $guard$;
