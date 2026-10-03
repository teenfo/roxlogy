-- ============================================================
-- Roxlogy — MCP get_crew_schedule: 취소된 모임도 포함 (2026-10-03)
--
-- 마이그레이션 128 은 취소된 모임을 뺐다. 이제 함께 돌려주고 cancelled·cancelled_at 을 붙인다.
-- 나머지는 128 과 같다. 키 추가·행 추가뿐 — 배포 순서 무관.
-- 되돌리기: 마이그레이션 128 의 mcp_crew_schedule 정의를 다시 적용.
-- ============================================================

create or replace function public.mcp_crew_schedule(p_token text, p_slug text,
                                                   p_from date default app_today(),
                                                   p_to date default (app_today() + 30))
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name,
      exists (select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active' and m.role <> 'associate') as full_member,
      exists (select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active') as member
    from crews c
    where c.slug = p_slug and c.status = 'active'
      and (c.is_public or exists (
        select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active')))
  select jsonb_build_object(
    'crew', (select name from c),
    'from', p_from, 'to', p_to,
    'meetups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'title', e.title, 'kind', e.kind, 'description', e.description,
        'starts_at', e.starts_at, 'ends_at', e.ends_at, 'location', e.location,
        'members_only', e.members_only, 'capacity', e.capacity,
        'comments_allowed', e.comments_allowed, 'free', e.fee_exempt,
        'closed', e.closed_at is not null, 'closed_at', e.closed_at,
        'cancelled', e.cancelled_at is not null, 'cancelled_at', e.cancelled_at,
        'coach', (select coalesce(nullif(p.display_name, ''), 'Athlete') from profiles p where p.id = e.coach_id),
        'created_by', (select coalesce(nullif(p.display_name, ''), 'Athlete') from profiles p where p.id = e.created_by),
        'created_at', e.created_at, 'updated_at', e.updated_at,
        'workout', (select jsonb_build_object('title', w.title, 'type', w.type, 'structure', w.structure)
                      from workout_templates w where w.id = e.template_id),
        'race_event', (select jsonb_build_object('name', re.name, 'city', re.city, 'country', re.country,
                                                 'start_date', re.start_date, 'end_date', re.end_date)
                         from race_events re where re.id = e.race_event_id),
        'going', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'going'),
        'maybe', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'maybe'),
        'declined', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'declined'),
        'waitlisted', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'waitlisted'),
        'checked_in', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.checked_in_at is not null),
        'my_rsvp', (select jsonb_build_object('status', r.status, 'checked_in', r.checked_in_at is not null)
                      from crew_event_rsvps r where r.event_id = e.id and r.user_id = (select id from u)),
        'comments', (select count(*) from crew_event_comments cm
                     where cm.event_id = e.id and cm.deleted_at is null),
        'polls', (select count(*) from crew_polls pl where pl.event_id = e.id),
        'open_polls', (select count(*) from crew_polls pl
                       where pl.event_id = e.id and pl.closed_at is null
                         and (pl.closes_at is null or pl.closes_at > now())),
        'rsvps', case when (select member from c) then coalesce((
            select jsonb_agg(jsonb_build_object(
                     'user_id', r.user_id,
                     'name', coalesce(nullif(p.display_name, ''), 'Athlete'),
                     'status', r.status,
                     'checked_in', r.checked_in_at is not null,
                     'tier', t.name)
                   order by array_position(array['going', 'waitlisted', 'maybe', 'declined'], r.status),
                            r.queued_at nulls first, p.display_name)
              from crew_event_rsvps r
              join profiles p on p.id = r.user_id
              left join crew_members m on m.crew_id = e.crew_id and m.user_id = r.user_id
              left join crew_member_tiers t on t.id = m.tier_id
             where r.event_id = e.id), '[]'::jsonb) end)
        order by e.starts_at)
      from crew_events e where e.crew_id = (select id from c)
        and (not e.members_only or (select full_member from c))
        and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to),
      '[]'::jsonb),
    'member_races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', rp.title, 'race_date', rp.race_date,
        'member', pr.display_name, 'user_id', rp.user_id,
        'division', rp.division, 'bib', rp.bib,
        'result_ms', (select r.total_time_ms from race_results r
                      where r.user_id = rp.user_id
                        and r.event_date between rp.race_date - 3 and rp.race_date + 3
                      order by r.total_time_ms asc nulls last limit 1))
        order by rp.race_date, rp.bib nulls last)
      from race_plans rp
      join crew_members m on m.user_id = rp.user_id
        and m.crew_id = (select id from c) and m.status = 'active'
      join profiles pr on pr.id = rp.user_id
      where rp.race_date between p_from and p_to), '[]'::jsonb),
    'crew_programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'program_id', p.id, 'title', p.title, 'start_date', pe.start_date,
        'end_date', pe.end_date, 'repeats', pe.repeat))
      from crew_program_enrollments pe
      join programs p on p.id = pe.program_id
      where pe.crew_id = (select id from c)), '[]'::jsonb)
  )
  from c;
$$;

-- ---------- 가드 -----------------------------------------------------------------
-- 취소된 모임이 있는 공개 크루에서 그 모임이 cancelled=true 로 실리는지 본다(비회원 시점).
do $$
declare v_slug text; v_ev uuid; j jsonb;
begin
  if not has_function_privilege('anon', 'public.mcp_crew_schedule(text, text, date, date)', 'execute') then
    raise exception '가드: 일정 조회 실행 권한이 사라졌습니다';
  end if;
  select c.slug, e.id into v_slug, v_ev from crews c join crew_events e on e.crew_id = c.id
   where c.status = 'active' and c.is_public and e.cancelled_at is not null and not e.members_only
   limit 1;
  if v_slug is null then raise notice '가드 건너뜀: 공개 크루의 취소된 모임 없음'; return; end if;
  j := mcp_crew_schedule('guard-no-token', v_slug, date '2000-01-01', date '2100-01-01');
  if not exists (select 1 from jsonb_array_elements(j->'meetups') x
                  where x->>'id' = v_ev::text and (x->>'cancelled')::boolean) then
    raise exception '가드: 취소된 모임이 일정에 없음';
  end if;
end $$;
