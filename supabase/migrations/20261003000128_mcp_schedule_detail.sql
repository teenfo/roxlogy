-- ============================================================
-- Roxlogy — MCP get_crew_schedule: 모임 정보를 빠짐없이 (2026-10-03)
--
-- 그동안 모임은 제목·시각·장소·정원·참석/대기 수만 돌려줘서, AI 가 일정을 설명하거나
-- 참석 여부를 지정(set_member_rsvp)하려면 정보가 모자랐다. 모임마다 다음을 덧붙인다:
--   종류(kind)·설명·종료 시각·코치·만든 사람·만든/고친 시각·댓글 허용·무료 행사·종료 여부,
--   연결된 운동(템플릿 제목·유형·구성)·연결된 대회(이름·도시·날짜),
--   응답 수(참석·미정·불참·대기·출석), 내 응답, 댓글 수, 투표 수(진행 중 포함),
--   크루원에게만: 응답자 명단 rsvps[{user_id, name, status, checked_in, tier}] —
--   공개 크루를 구경하는 비회원에게는 명단을 주지 않는다(웹 RLS 와 같은 선).
-- 대회 참가·크루 프로그램에도 user_id·program_id 를 덧붙인다(도구 연결용).
-- 인자·이름 그대로, 키 추가만 — 배포 순서 무관.
-- 되돌리기: 마이그레이션 이전의 mcp_crew_schedule 정의를 다시 적용.
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
        and e.cancelled_at is null
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
-- 크루원 토큰 없이 직접 확인할 수 없으므로(토큰은 해시) 비회원 시점만: 공개 크루 일정에 새 키가
-- 실리고 명단(rsvps)은 비어 있는지(null) 본다. 실행 권한도 그대로인지 확인.
do $$
declare v_slug text; j jsonb; x jsonb;
begin
  if not has_function_privilege('anon', 'public.mcp_crew_schedule(text, text, date, date)', 'execute') then
    raise exception '가드: 일정 조회 실행 권한이 사라졌습니다';
  end if;
  select c.slug into v_slug from crews c
   where c.status = 'active' and c.is_public
     and exists (select 1 from crew_events e where e.crew_id = c.id and e.cancelled_at is null and not e.members_only)
   limit 1;
  if v_slug is null then raise notice '가드 건너뜀: 공개 크루 모임 없음'; return; end if;
  j := mcp_crew_schedule('guard-no-token', v_slug, date '2000-01-01', date '2100-01-01');
  x := j->'meetups'->0;
  if x is null or not (x ? 'kind' and x ? 'description' and x ? 'maybe' and x ? 'free' and x ? 'rsvps') then
    raise exception '가드: 모임 상세 키가 없음 %', x;
  end if;
  if x->'rsvps' <> 'null'::jsonb then raise exception '가드: 비회원에게 명단이 나감'; end if;
end $$;
