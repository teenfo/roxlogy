-- ============================================================
-- Roxlogy — 시스템 감사 수리 (1) 보안 · MCP RPC · 리더보드 가드
--
-- 1) 호출자 검증이 없는 SECURITY DEFINER 함수의 클라이언트 실행 권한 회수
--    · enqueue_notification: 임의 사용자에게 임의 제목/본문/URL 알림 삽입
--      → anon 키만으로 피싱 푸시 발송이 가능했다
--    · enqueue_wod_reminders: 전체 사용자 대상 크론 발송 트리거
--    · _mcp_insert_workouts: 소유권 검사 없이 임의 program_day 에 워크아웃 주입
--    셋 다 내부 호출(트리거·크론·상위 definer 함수)은 소유자 권한으로 도므로
--    회수해도 정상 동작한다. 트리거 함수도 위생상 함께 회수.
--    이후 새로 만드는 함수는 기본 실행 권한을 주지 않는다(fail-closed) —
--    클라이언트가 호출할 RPC 는 반드시 명시적으로 grant execute 할 것.
-- 2) mcp_crew_schedule: 드롭된 programs.repeat_enabled 참조로 전면 오류 →
--    crew_program_enrollments.repeat 바인딩으로 재정의. 모임에 id 추가
--    (rsvp_meetup 이 event_id 를 요구하는데 어떤 읽기 도구도 주지 않았다).
-- 3) leaderboard_station / mcp_stats: 풀 시뮬 가드 누락 → 탭 테스트로 넘긴
--    2~3초 세그먼트가 스테이션 1위가 될 수 있었다. overall 과 같은 규칙 적용.
-- 4) advisor: search_path 미고정 함수 3건 고정.
-- ============================================================

-- ---------- 1) 위험 함수 실행 권한 회수
revoke execute on function public.enqueue_notification(uuid, text, text, text, text)
  from anon, authenticated;
revoke execute on function public.enqueue_wod_reminders()
  from anon, authenticated;
revoke execute on function public._mcp_insert_workouts(uuid, jsonb)
  from anon, authenticated;

-- 트리거 함수: PostgREST 로 직접 호출할 수 없지만 노출면을 남기지 않는다
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where pg_get_function_result(p.oid) = 'trigger'
  loop
    execute format('revoke execute on function %s from anon, authenticated', f.sig);
  end loop;
end $$;

-- 앞으로 만드는 함수는 기본 실행 권한 없음 (기존 함수의 권한은 그대로 유지)
-- ⚠ 클라이언트(웹 anon 키·MCP)가 호출할 RPC 는 정의 뒤에 반드시
--    grant execute on function public.<name>(<args>) to anon, authenticated; 를 붙일 것
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- ---------- 4) advisor: search_path 고정
alter function public.set_updated_at() set search_path to 'public';
alter function public.clone_program(uuid, text) set search_path to 'public';
alter function public.norm_exname(text) set search_path to 'public';

-- ---------- 2) mcp_crew_schedule 재정의 (repeat 바인딩 + 모임 id)
create or replace function public.mcp_crew_schedule(
  p_token text, p_slug text,
  p_from date default current_date, p_to date default (current_date + 30)
)
returns jsonb
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
        'id', e.id,
        'title', e.title, 'starts_at', e.starts_at, 'location', e.location,
        'members_only', e.members_only, 'capacity', e.capacity,
        'going', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'going'),
        'waitlisted', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'waitlisted'))
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
        'end_date', pe.end_date, 'repeats', pe.repeat))
      from crew_program_enrollments pe
      join programs p on p.id = pe.program_id
      where pe.crew_id = (select id from c)), '[]'::jsonb)
  )
  from c;
$$;
grant execute on function public.mcp_crew_schedule(text, text, date, date)
  to anon, authenticated;

-- ---------- 3) 리더보드: 스테이션도 풀 시뮬 세션에서만 집계
-- 기준은 leaderboard_overall(20260809000004)과 동일 — 런8+스테이션8, 총 30분↑
create or replace function public.leaderboard_station(
  p_exercise uuid, p_division text default null
)
returns table(rank bigint, display_name text, division text, best_ms bigint)
language sql stable security definer set search_path to 'public' as $$
  with best as (
    select s.user_id, s.division, min(g.split_time_ms) as best_ms
    from session_segments g
    join sessions s on s.id = g.session_id
    where s.deleted_at is null
      and coalesce(s.leaderboard_excluded, false) = false
      and g.kind = 'station'
      and g.exercise_id = p_exercise
      and g.split_time_ms is not null
      and s.total_time_ms is not null
      and s.total_time_ms >= 1800000
      and (
        select count(*) filter (where x.kind = 'station') >= 8
           and count(*) filter (where x.kind = 'run') >= 8
        from session_segments x where x.session_id = s.id
      )
    group by s.user_id, s.division
  )
  select row_number() over (order by best.best_ms asc) as rank,
         coalesce(p.display_name, 'Athlete') as display_name,
         best.division,
         best.best_ms
  from best
  join profiles p on p.id = best.user_id
  where p.leaderboard_opt_in = true
    and (p_division is null or best.division = p_division)
  order by best.best_ms asc
  limit 100;
$$;
grant execute on function public.leaderboard_station(uuid, text)
  to anon, authenticated;

-- mcp_stats 의 station_prs 도 같은 가드 (개인 PR 이므로 opt-in 은 무관)
create or replace function public.mcp_stats(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id)
  select jsonb_build_object(
    'station_prs', coalesce((
      select jsonb_agg(jsonb_build_object('exercise', e.name_ko, 'best_ms', t.best))
      from (
        select g.exercise_id, min(g.split_time_ms) as best
        from session_segments g
        join sessions s on s.id = g.session_id
        where s.user_id = (select id from u) and s.deleted_at is null
          and g.kind = 'station' and g.split_time_ms is not null
          and s.total_time_ms is not null
          and s.total_time_ms >= 1800000
          and (
            select count(*) filter (where x.kind = 'station') >= 8
               and count(*) filter (where x.kind = 'run') >= 8
            from session_segments x where x.session_id = s.id
          )
        group by g.exercise_id) t
      join exercises e on e.id = t.exercise_id), '[]'::jsonb),
    'last_8_weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', w.wk, 'sessions', w.n, 'total_ms', w.tot) order by w.wk)
      from (
        select date_trunc('week', started_at)::date as wk,
               count(*) as n, sum(total_time_ms) as tot
        from sessions
        where user_id = (select id from u) and deleted_at is null
          and started_at >= now() - interval '8 weeks'
        group by 1) w), '[]'::jsonb),
    'latest_race', (
      select to_jsonb(x) from (
        select id, event, event_date, division, total_time_ms
        from race_results where user_id = (select id from u)
        order by event_date desc nulls last limit 1) x),
    'goal', (
      select to_jsonb(x) from (
        select target_total_ms, run_total_ms, station_total_ms,
               roxzone_total_ms, division, event_name, event_date
        from goal_plans where user_id = (select id from u)
        order by created_at desc limit 1) x),
    'field_benchmarks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'division', b.division, 'gender', b.gender,
        'p50_ms', (b.percentiles->>'p50')::bigint,
        'p90_ms', (b.percentiles->>'p90')::bigint,
        'sample', b.sample_size))
      from race_benchmarks b where b.scope = 'overall'), '[]'::jsonb)
  )
  from u where u.id is not null;
$$;
grant execute on function public.mcp_stats(text) to anon, authenticated;

-- ---------- 검증 가드
do $$
begin
  if exists (
    select 1 from information_schema.routine_privileges r
    join pg_proc p on p.proname = r.routine_name
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where r.specific_schema = 'public'
      and r.specific_name = p.proname || '_' || p.oid
      and r.grantee in ('anon', 'authenticated')
      and p.proname in ('enqueue_notification', 'enqueue_wod_reminders',
                        '_mcp_insert_workouts')) then
    raise exception 'dangerous definer functions still executable by clients';
  end if;
end $$;
