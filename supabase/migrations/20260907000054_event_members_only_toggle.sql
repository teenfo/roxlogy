-- ============================================================
-- Roxlogy — 정회원 전용을 만든 뒤에도 바꿀 수 있게
--
-- 정회원 전용(members_only)은 모임 등록 폼에서만 정할 수 있었다. 무료 행사와
-- 같이 상세 화면에서 토글한다.
--
-- 켜면 정회원 권한이 없는 등급의 크루원은 그 모임을 아예 못 본다. 이미
-- 참석 신청하거나 출석한 기록은 지우지 않는다 — 실제로 있었던 일이고,
-- 지우면 출석 통계와 회차비 청구의 근거가 사라진다. 대신 몇 명이 보이지
-- 않게 되는지 세어 돌려주어 화면이 미리 알릴 수 있게 한다.
-- ============================================================

create or replace function public.set_event_members_only(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; n int := 0;
begin
  select e.crew_id into v_crew from crew_events e where e.id = p_event;
  if v_crew is null then raise exception 'event_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'attend_not_staff';
  end if;

  if p_on then
    select count(*) into n
      from crew_event_rsvps r
      join crew_members m on m.crew_id = v_crew and m.user_id = r.user_id
                         and m.status = 'active'
      left join crew_member_tiers t on t.id = m.tier_id
     where r.event_id = p_event
       and m.role not in ('owner', 'coach')
       and not coalesce(t.is_full_member, false);
  end if;

  update crew_events set members_only = p_on where id = p_event;
  return jsonb_build_object('members_only', p_on, 'hidden_from', n);
end;
$$;
grant execute on function public.set_event_members_only(uuid, boolean) to authenticated;

-- 상세에 members_only 노출 (반환형 변경 → 재생성). 조회 게이트는 그대로.
drop function if exists public.crew_event_detail(uuid);
create function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going_names text[], maybe_names text[], declined_count bigint,
  my_status text, is_staff boolean,
  comments_allowed boolean, comments jsonb, waitlist_names text[],
  fee_exempt boolean, members_only boolean
)
language sql stable security definer set search_path to 'public' as $$
  select e.id, c.slug, e.title, e.description, e.kind,
         e.starts_at, e.ends_at, e.location, e.capacity,
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'going'), '{}'),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'maybe'), '{}'),
         (select count(*) from crew_event_rsvps r
            where r.event_id = e.id and r.status = 'declined'),
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
         e.fee_exempt,
         e.members_only
  from crew_events e
  join crews c on c.id = e.crew_id
  where e.id = p_event
    and e.cancelled_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not e.members_only or is_crew_full_member(e.crew_id));
$$;
grant execute on function public.crew_event_detail(uuid) to anon, authenticated;
