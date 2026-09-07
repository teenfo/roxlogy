-- ============================================================
-- Roxlogy — 모임 상세의 "참석 안 함"을 숫자에서 명단으로
--
-- 참석·미정·대기는 이름이 나오는데 참석 안 함만 건수였다. 누가 못 온다고
-- 했는지 알아야 운영진이 정원·조 편성을 조정할 수 있다.
-- declined_count 를 declined_names 로 바꾼다 (건수는 배열 길이로 얻는다).
-- ============================================================

drop function if exists public.crew_event_detail(uuid);
create function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going_names text[], maybe_names text[], declined_names text[],
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

do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_event_detail'
    and a.nm = 'declined_names';
  if n <> 1 then raise exception '가드: declined_names 가 없습니다'; end if;

  if position('is_crew_full_member' in
       (select pg_get_functiondef(oid) from pg_proc
         where pronamespace = 'public'::regnamespace and proname = 'crew_event_detail')) = 0 then
    raise exception '가드: 정회원 전용 게이트가 사라졌습니다';
  end if;
end $$;
