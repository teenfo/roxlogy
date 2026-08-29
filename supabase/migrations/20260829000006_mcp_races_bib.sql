-- ============================================================
-- Roxlogy — mcp_crew_schedule 의 member_races 에 division·bib 추가
-- (출전 일정 통합·BIB 도입에 맞춰 MCP 응답도 동일 정보 제공)
-- ============================================================

create or replace function public.mcp_crew_schedule(
  p_token text, p_slug text,
  p_from date default current_date, p_to date default (current_date + 30)
) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name,
      exists (select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active' and m.role <> 'associate') as full_member
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
        'title', e.title, 'starts_at', e.starts_at, 'location', e.location,
        'members_only', e.members_only,
        'going', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'going'))
        order by e.starts_at)
      from crew_events e where e.crew_id = (select id from c)
        and e.cancelled_at is null
        and (not e.members_only or (select full_member from c))
        and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to),
      '[]'::jsonb),
    'member_races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', rp.title, 'race_date', rp.race_date,
        'member', pr.display_name,
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
        'title', p.title, 'start_date', pe.start_date,
        'end_date', pe.end_date, 'repeats', p.repeat_enabled))
      from crew_program_enrollments pe
      join programs p on p.id = pe.program_id
      where pe.crew_id = (select id from c)), '[]'::jsonb)
  )
  from c;
$$;
