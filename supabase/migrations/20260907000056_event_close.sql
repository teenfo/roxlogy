-- ============================================================
-- Roxlogy — 모임 종료
--
-- 끝난 모임의 참석 응답을 잠근다. 취소(cancelled_at)와 다르다:
--   · 취소 = 모임이 없어진다 (목록·상세에서 사라진다)
--   · 종료 = 모임은 그대로 보이고, 참석/미정/불참만 못 바꾼다
--
-- 운영진은 종료 뒤에도 출석을 고칠 수 있다 — 종료 시점에 오타가 있으면
-- 되돌릴 방법이 없으면 안 된다. 종료 해제도 된다.
-- 차단은 UI 가 아니라 RLS 로 한다(본인 응답 insert/update/delete 정책에
-- closed_at is null 조건 추가). 스태프 분기는 그대로 둔다.
-- ============================================================

alter table public.crew_events
  add column if not exists closed_at timestamptz;

create or replace function public.set_event_closed(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select e.crew_id into v_crew from crew_events e
   where e.id = p_event and e.cancelled_at is null;
  if v_crew is null then raise exception 'event_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'attend_not_staff';
  end if;
  update crew_events
     set closed_at = case when p_on then now() else null end
   where id = p_event;
  return jsonb_build_object('closed', p_on);
end;
$$;
grant execute on function public.set_event_closed(uuid, boolean) to authenticated;

drop policy if exists crew_event_rsvps_upsert_self on public.crew_event_rsvps;
create policy crew_event_rsvps_upsert_self on public.crew_event_rsvps
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from crew_events e
      where e.id = event_id and is_crew_member(e.crew_id) and e.closed_at is null
    )
  );

drop policy if exists crew_event_rsvps_update on public.crew_event_rsvps;
create policy crew_event_rsvps_update on public.crew_event_rsvps
  for update using (
    (user_id = (select auth.uid()) and exists (
       select 1 from crew_events e where e.id = event_id and e.closed_at is null))
    or exists (
      select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id))
  ) with check (
    (user_id = (select auth.uid()) and exists (
       select 1 from crew_events e where e.id = event_id and e.closed_at is null))
    or exists (
      select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id))
  );

drop policy if exists crew_event_rsvps_delete_self on public.crew_event_rsvps;
create policy crew_event_rsvps_delete_self on public.crew_event_rsvps
  for delete using (
    (user_id = (select auth.uid()) and exists (
       select 1 from crew_events e where e.id = event_id and e.closed_at is null))
    or exists (
      select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id))
  );

-- 상세에 closed_at 노출 (반환형 변경 → 재생성). 조회 게이트는 그대로.
drop function if exists public.crew_event_detail(uuid);
create function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going_names text[], maybe_names text[], declined_names text[],
  my_status text, is_staff boolean,
  comments_allowed boolean, comments jsonb, waitlist_names text[],
  fee_exempt boolean, members_only boolean, closed_at timestamptz
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
$$;
grant execute on function public.crew_event_detail(uuid) to anon, authenticated;
