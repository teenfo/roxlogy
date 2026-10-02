-- ============================================================
-- Roxlogy — 모임 상세 "참석" 명단도 리더 > 부리더 > 등급 > 이름 (2026-10-02)
--
-- 119 에서 회원 목록을 리더 > 부리더 > 등급(지정 순서) > 이름으로 맞췄는데, 모임 상세의
-- 참석 칩(crew_event_detail.going)만 등급 > 이름이었다. 같은 규칙으로 맞춘다.
-- 크루원이 아닌 사람에게는 등급을 내리지 않으므로(tier·color = null) 정렬도 이름만 —
-- 예전과 같다(정렬로 운영진·등급이 드러나지 않게).
-- 정렬만 바뀌고 반환 모양은 그대로 — 배포 순서 무관. 지우는 문장 없음.
-- 되돌리기: 071(event_going_order)의 정의를 다시 적용.
-- ============================================================

create or replace function public.crew_event_detail(p_event uuid)
returns table(id uuid, slug text, title text, description text, kind text,
              starts_at timestamp with time zone, ends_at timestamp with time zone, location text,
              capacity integer, going jsonb, maybe_names text[], declined_names text[], my_status text,
              is_staff boolean, comments_allowed boolean, comments jsonb, waitlist_names text[],
              fee_exempt boolean, members_only boolean, closed_at timestamp with time zone)
language sql stable security definer set search_path to 'public' as $$
  select e.id, c.slug, e.title, e.description, e.kind,
         e.starts_at, e.ends_at, e.location, e.capacity,
         coalesce((select jsonb_agg(jsonb_build_object(
              'name', coalesce(pr.display_name, 'Athlete'),
              'tier', case when is_crew_member(e.crew_id) then ti.name end,
              'color', case when is_crew_member(e.crew_id) then ti.color end)
              order by
                case when is_crew_member(e.crew_id)
                     then coalesce(array_position(array['owner', 'coach'], m.role), 3) else 0 end,
                case when is_crew_member(e.crew_id)
                     then coalesce(ti.sort_order, 2147483647) else 0 end,
                case when is_crew_member(e.crew_id) then ti.created_at end,
                case when is_crew_member(e.crew_id) then ti.id end,
                lower(coalesce(pr.display_name, 'Athlete')))
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

-- ---------- 가드 -----------------------------------------------------------------
-- 참석자가 가장 많은 모임을 그 크루 크루장 시점으로 읽어 순서를 확인한 뒤 되감는다.
do $$
declare
  v_event uuid; v_owner uuid; g jsonb; x jsonb; i int := 0;
  v_rk int; v_so int; v_nm text; v_prev_rk int; v_prev_so int; v_prev_nm text;
begin
  select e.id, m.user_id into v_event, v_owner
    from crew_events e
    join crew_members m on m.crew_id = e.crew_id and m.role = 'owner' and m.status = 'active'
   where e.cancelled_at is null
   order by (select count(*) from crew_event_rsvps r where r.event_id = e.id and r.status = 'going') desc
   limit 1;
  if v_event is null then raise notice '가드 건너뜀: 모임 없음'; return; end if;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    select d.going into g from crew_event_detail(v_event) d;
    if g is null then raise exception '가드: 모임 상세를 못 읽음'; end if;
    -- 반환된 이름 순서를 같은 규칙으로 다시 계산한 키와 비교한다
    for x in select * from jsonb_array_elements(g) loop
      select coalesce(array_position(array['owner', 'coach'], m.role), 3),
             coalesce(t.sort_order, 2147483647), lower(x->>'name')
        into v_rk, v_so, v_nm
        from crew_event_rsvps r
        join profiles p on p.id = r.user_id
        left join crew_members m on m.crew_id = (select crew_id from crew_events where id = v_event)
             and m.user_id = r.user_id and m.status = 'active'
        left join crew_member_tiers t on t.id = m.tier_id
       where r.event_id = v_event and r.status = 'going'
         and coalesce(p.display_name, 'Athlete') = x->>'name'
       order by 1, 2 limit 1;
      if v_prev_rk is not null and (v_rk, v_so, v_nm) < (v_prev_rk, v_prev_so, v_prev_nm) then
        raise exception '가드: 참석 명단 정렬이 리더>부리더>등급>이름이 아님 (% % % 다음 % % %)',
          v_prev_rk, v_prev_so, v_prev_nm, v_rk, v_so, v_nm;
      end if;
      v_prev_rk := v_rk; v_prev_so := v_so; v_prev_nm := v_nm;
    end loop;
    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
