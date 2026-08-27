-- ============================================================
-- Roxlogy — MCP(Model Context Protocol) 읽기 API
--
-- 사용자가 자신의 AI(Claude 등)를 Roxlogy 데이터에 연결하는 개인 토큰 API.
-- 캘린더 구독 토큰과 같은 패턴: profiles.mcp_token 이 곧 자격증명이고,
-- SECURITY DEFINER RPC 가 토큰 검증 후 그 사용자 스코프의 데이터만 반환한다.
-- service role 키를 웹 서버에 두지 않아도 되는 구조 (anon 키로 RPC 호출).
-- 전부 읽기 전용. 크루 데이터는 멤버십(회계는 활성 멤버)을 명시 검증한다.
-- ============================================================

alter table public.profiles
  add column if not exists mcp_token text not null
    default encode(gen_random_bytes(24), 'hex');

create index if not exists profiles_mcp_token_idx
  on public.profiles (mcp_token);

-- 토큰 → 사용자. 이하 모든 RPC 의 공통 관문.
create or replace function public.mcp_uid(p_token text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select id from profiles
  where p_token is not null and length(p_token) >= 24 and mcp_token = p_token;
$$;

-- ---------- 프로필 (연동 상태·크루 멤버십 포함)
create or replace function public.mcp_profile(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'display_name', p.display_name,
    'gender', p.gender,
    'birth_year', p.birth_year,
    'hyrox_athlete_name', p.hyrox_athlete_name,
    'hyrox_linked', p.hyrox_person_ref is not null,
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'role', m.role))
      from crew_members m join crews c on c.id = m.crew_id
      where m.user_id = p.id and m.status = 'active'), '[]'::jsonb)
  )
  from profiles p where p.id = mcp_uid(p_token);
$$;

-- ---------- 세션 목록
create or replace function public.mcp_sessions(p_token text, p_limit int default 20)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.started_at desc), '[]'::jsonb)
  from (
    select s.id, s.started_at, s.total_time_ms, s.source_device, s.division,
           r.event as race_event, r.event_date as race_date
    from sessions s
    left join race_results r on r.id = s.race_result_id
    where s.user_id = mcp_uid(p_token) and s.deleted_at is null
    order by s.started_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) t;
$$;

-- ---------- 세션 상세 (세그먼트·지표 포함)
create or replace function public.mcp_session(p_token text, p_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', s.id,
    'started_at', s.started_at,
    'total_time_ms', s.total_time_ms,
    'source_device', s.source_device,
    'division', s.division,
    'notes', s.notes,
    'metrics', (select to_jsonb(m) - 'session_id' from session_metrics m
                where m.session_id = s.id),
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq', g.seq, 'kind', g.kind,
        'exercise', e.name_ko,
        'split_time_ms', g.split_time_ms,
        'avg_hr', g.avg_hr, 'max_hr', g.max_hr) order by g.seq)
      from session_segments g
      left join exercises e on e.id = g.exercise_id
      where g.session_id = s.id), '[]'::jsonb)
  )
  from sessions s
  where s.id = p_id and s.user_id = mcp_uid(p_token) and s.deleted_at is null;
$$;

-- ---------- 레이스 목록
create or replace function public.mcp_races(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.event_date desc nulls last), '[]'::jsonb)
  from (
    select r.id, r.event, r.event_date, r.division, r.season, r.total_time_ms,
           r.splits->>'bib' as bib,
           (r.splits->>'rank_overall')::int as rank_overall,
           (r.splits->>'field_size')::int as field_size
    from race_results r
    where r.user_id = mcp_uid(p_token)
  ) t;
$$;

-- ---------- 레이스 상세 (전체 스플릿·세그먼트 순위 포함)
create or replace function public.mcp_race(p_token text, p_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select to_jsonb(r) - 'user_id' - 'ai_status'
  from race_results r
  where r.id = p_id and r.user_id = mcp_uid(p_token);
$$;

-- ---------- 통계 (스테이션 PR·주간 볼륨·최근 레이스·필드 벤치마크)
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

-- ---------- 오늘 (프로그램 일차 + 크루 모임 14일 + 내 대회 30일)
create or replace function public.mcp_today(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  en as (
    select pe.start_date, p.id as pid, p.title, p.end_date, p.repeat_enabled,
           (select max(d.day_index) from program_days d where d.program_id = p.id) as cyc
    from program_enrollments pe join programs p on p.id = pe.program_id
    where pe.user_id = (select id from u) and pe.active limit 1),
  prog as (
    select e.pid, e.title,
      case
        when e.end_date is not null and current_date > e.end_date then null
        when current_date < e.start_date then null
        when e.repeat_enabled and coalesce(e.cyc, 0) > 0
          then ((current_date - e.start_date) % e.cyc) + 1
        when (current_date - e.start_date) < coalesce(e.cyc, 0)
          then (current_date - e.start_date) + 1
        else null
      end as day_idx
    from en e)
  select jsonb_build_object(
    'today_program', (
      select jsonb_build_object(
        'program', pr.title, 'day', pr.day_idx, 'focus', d.focus,
        'workouts', coalesce((
          select jsonb_agg(jsonb_build_object('title', w.title, 'type', w.type))
          from workout_templates w where w.program_day_id = d.id), '[]'::jsonb))
      from prog pr
      join program_days d on d.program_id = pr.pid and d.day_index = pr.day_idx
      where pr.day_idx is not null),
    'crew_meetups_14d', coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew', c.name, 'title', e.title, 'starts_at', e.starts_at,
        'location', e.location) order by e.starts_at)
      from crew_events e
      join crews c on c.id = e.crew_id
      join crew_members m on m.crew_id = c.id
        and m.user_id = (select id from u) and m.status = 'active'
      where e.cancelled_at is null
        and e.starts_at between now() and now() + interval '14 days'), '[]'::jsonb),
    'my_race_plans_30d', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', rp.title, 'race_date', rp.race_date, 'note', rp.note)
        order by rp.race_date)
      from race_plans rp
      where rp.user_id = (select id from u)
        and rp.race_date between current_date and current_date + 30), '[]'::jsonb)
  )
  from u where u.id is not null;
$$;

-- ---------- 크루 정보 (slug 없으면 내 크루 목록)
create or replace function public.mcp_crew(p_token text, p_slug text default null)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id)
  select case
    when p_slug is null then coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'tagline', c.tagline, 'role', m.role))
      from crew_members m join crews c on c.id = m.crew_id
      where m.user_id = (select id from u) and m.status = 'active'), '[]'::jsonb)
    else (
      select jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'tagline', c.tagline,
        'description', c.description, 'location', c.location,
        'hours_weekday', c.links->>'hours_weekday',
        'hours_weekend', c.links->>'hours_weekend',
        'contact', c.links->>'phone',
        'official_link', c.links->>'official',
        'rules', c.links->>'policy',
        'member_count', (select count(*) from crew_members mm
                         where mm.crew_id = c.id and mm.status = 'active'),
        'my_role', (select m.role from crew_members m
                    where m.crew_id = c.id and m.user_id = (select id from u)
                      and m.status = 'active'))
      from crews c
      where c.slug = p_slug and c.status = 'active'
        and (c.is_public or exists (
          select 1 from crew_members m
          where m.crew_id = c.id and m.user_id = (select id from u)
            and m.status = 'active')))
  end
  from u where u.id is not null;
$$;

-- ---------- 크루 일정 (모임 RSVP 수·크루원 대회·크루 프로그램)
create or replace function public.mcp_crew_schedule(
  p_token text, p_slug text,
  p_from date default current_date, p_to date default current_date + 30
)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name from crews c
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
        'going', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'going'))
        order by e.starts_at)
      from crew_events e where e.crew_id = (select id from c)
        and e.cancelled_at is null
        and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to),
      '[]'::jsonb),
    'member_races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', rp.title, 'race_date', rp.race_date,
        'member', pr.display_name,
        'result_ms', (select r.total_time_ms from race_results r
                      where r.user_id = rp.user_id
                        and r.event_date between rp.race_date - 3 and rp.race_date + 3
                      order by r.total_time_ms asc nulls last limit 1))
        order by rp.race_date)
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

-- ---------- 크루 회계 (활성 멤버 전용 — 월 합계·누적 잔액·내역)
create or replace function public.mcp_crew_finance(
  p_token text, p_slug text, p_month text default null
)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name from crews c
    join crew_members m on m.crew_id = c.id
      and m.user_id = (select id from u) and m.status = 'active'
    where c.slug = p_slug and c.status = 'active'),
  mo as (
    select case when p_month ~ '^\d{4}-\d{2}$' then p_month
                else to_char(current_date, 'YYYY-MM') end as m),
  rng as (
    select (m || '-01')::date as f,
           ((m || '-01')::date + interval '1 month' - interval '1 day')::date as t
    from mo)
  select jsonb_build_object(
    'crew', (select name from c),
    'month', (select m from mo),
    'month_income', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'income'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    'month_expense', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'expense'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    'total_balance', coalesce((select sum(case when kind = 'income' then amount
                                               else -amount end)
      from crew_ledger where crew_id = (select id from c)), 0),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', l.entry_date, 'kind', l.kind, 'amount', l.amount,
        'title', l.title, 'memo', l.memo) order by l.entry_date desc)
      from crew_ledger l
      where l.crew_id = (select id from c)
        and l.entry_date between (select f from rng) and (select t from rng)),
      '[]'::jsonb)
  )
  from c;
$$;

grant execute on function
  public.mcp_profile(text),
  public.mcp_sessions(text, int),
  public.mcp_session(text, uuid),
  public.mcp_races(text),
  public.mcp_race(text, uuid),
  public.mcp_stats(text),
  public.mcp_today(text),
  public.mcp_crew(text, text),
  public.mcp_crew_schedule(text, text, date, date),
  public.mcp_crew_finance(text, text, text)
to anon, authenticated;
