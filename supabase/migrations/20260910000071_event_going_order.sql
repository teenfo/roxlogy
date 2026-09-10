-- 모임 참석 명단을 등급(정회원 → 일반회원 → 게스트) → 이름순으로 정렬한다.
--
-- 지금까지는 RSVP 를 누른 순서(r.created_at)였다. 명단을 보는 이유는 대개
-- "누가 오나"를 훑는 것이고, 신청 순서는 그때 아무 의미가 없다.
-- 등급은 크루가 정한 sort_order 를 따른다 (LOOP8 기준 정회원 1 · 일반회원 2 ·
-- 게스트 3). 등급이 없는 사람은 뒤로.
--
-- 비회원에게는 등급 자체가 내려가지 않으므로 등급으로 묶어 보여줄 이유도 없다
-- — 그때는 이름순만 쓴다(등급 구성이 순서로 새어 나가지 않게).
--
-- 반환 모양은 그대로고 정렬만 바뀌므로 배포 순서를 신경 쓰지 않아도 된다.
create or replace function public.crew_event_detail(p_event uuid)
returns table(id uuid, slug text, title text, description text, kind text,
              starts_at timestamptz, ends_at timestamptz, location text,
              capacity integer, going jsonb, maybe_names text[],
              declined_names text[], my_status text, is_staff boolean,
              comments_allowed boolean, comments jsonb, waitlist_names text[],
              fee_exempt boolean, members_only boolean, closed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, c.slug, e.title, e.description, e.kind,
         e.starts_at, e.ends_at, e.location, e.capacity,
         coalesce((select jsonb_agg(jsonb_build_object(
              'name', coalesce(pr.display_name, 'Athlete'),
              -- 등급은 크루원에게만
              'tier', case when is_crew_member(e.crew_id) then ti.name end,
              'color', case when is_crew_member(e.crew_id) then ti.color end)
              order by
                case when is_crew_member(e.crew_id)
                     then coalesce(ti.sort_order, 99) else 0 end,
                coalesce(pr.display_name, 'Athlete'))
            from crew_event_rsvps r
            join profiles pr on pr.id = r.user_id
            left join crew_members m
              on m.crew_id = e.crew_id and m.user_id = r.user_id
                 and m.status = 'active'
            left join crew_member_tiers ti on ti.id = m.tier_id
            where r.event_id = e.id and r.status = 'going'), '[]'::jsonb),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete')
              order by coalesce(pr.display_name, 'Athlete'))
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'maybe'), '{}'),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete')
              order by coalesce(pr.display_name, 'Athlete'))
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
         -- 대기 명단은 줄이다 — 순서를 바꾸면 누가 먼저인지가 사라진다
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
$$;

grant execute on function public.crew_event_detail(uuid) to anon, authenticated;

-- 검증 — 크루원 시점에서 (등급 순서, 이름) 순으로 나오는지 실제 모임으로 확인
do $$
declare
  v_event uuid;
  v_crew uuid;
  v_user uuid;
  v_got text[];
  v_want text[];
begin
  select r.event_id into v_event
    from crew_event_rsvps r
    join crew_events e on e.id = r.event_id and e.cancelled_at is null
   where r.status = 'going'
   group by r.event_id
   order by count(*) desc
   limit 1;
  if v_event is null then
    raise notice 'no going rsvps — skipping guard';
    return;
  end if;

  select e.crew_id into v_crew from crew_events e where e.id = v_event;
  select m.user_id into v_user from crew_members m
   where m.crew_id = v_crew and m.status = 'active'
   order by array_position(array['owner','coach'], m.role) nulls last
   limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  select array_agg(el->>'name' order by ord) into v_got
    from crew_event_detail(v_event) d,
         lateral jsonb_array_elements(d.going) with ordinality as x(el, ord);

  select array_agg(q.nm order by q.so, q.nm) into v_want
    from (select coalesce(pr.display_name, 'Athlete') as nm,
                 coalesce(ti.sort_order, 99) as so
            from crew_event_rsvps r
            join profiles pr on pr.id = r.user_id
            left join crew_members m
              on m.crew_id = v_crew and m.user_id = r.user_id
                 and m.status = 'active'
            left join crew_member_tiers ti on ti.id = m.tier_id
           where r.event_id = v_event and r.status = 'going') q;

  if v_got is distinct from v_want then
    raise exception 'going order mismatch: % vs %', v_got, v_want;
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;
