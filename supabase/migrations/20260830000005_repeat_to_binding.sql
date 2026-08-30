-- ============================================================
-- Roxlogy — 반복 옵션도 바인딩으로 이관
--
-- "설정 기간 동안 반복"은 템플릿이 아니라 "어떻게 돌릴지"의 속성이다.
--   개인 = program_enrollments.repeat + end_date (등록 모달에서 선택)
--   크루 = crew_program_enrollments.repeat (+ 기존 start/end)
-- programs.repeat_enabled 를 제거하고 기존 값은 바인딩으로 백필한다.
-- ============================================================

alter table public.program_enrollments
  add column if not exists repeat boolean not null default false;
alter table public.program_enrollments
  add column if not exists end_date date;
alter table public.crew_program_enrollments
  add column if not exists repeat boolean not null default false;

-- 백필: 템플릿의 반복 플래그를 기존 바인딩으로
update public.program_enrollments pe set repeat = true
from public.programs p where p.id = pe.program_id and p.repeat_enabled;
update public.crew_program_enrollments ce set repeat = true
from public.programs p where p.id = ce.program_id and p.repeat_enabled;

-- crew_calendar: 반복을 크루 바인딩에서 읽는다 (반환형 동일 → replace)
create or replace function public.crew_calendar(
  p_slug text, p_from date, p_to date
)
returns table(
  kind text,
  on_date date,
  starts_at timestamptz,
  ref_id uuid,
  title text,
  subtitle text,
  member_id uuid,
  member_name text,
  going_count bigint,
  my_status text,
  result_ms bigint,
  members_only boolean
)
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select id, is_public from crews
    where slug = p_slug and status = 'active'
  ), ok as (
    select 1 from c where c.is_public or is_crew_member(c.id)
  ),
  meetups as (
    select 'meetup'::text as kind,
           (e.starts_at at time zone 'Asia/Seoul')::date as on_date,
           e.starts_at, e.id as ref_id, e.title,
           coalesce(e.location, '') as subtitle,
           null::uuid as member_id, null::text as member_name,
           (select count(*) from crew_event_rsvps r
              where r.event_id = e.id and r.status = 'going') as going_count,
           (select r.status from crew_event_rsvps r
              where r.event_id = e.id and r.user_id = auth.uid()) as my_status,
           null::bigint as result_ms,
           e.members_only
    from crew_events e join c on c.id = e.crew_id
    where e.cancelled_at is null
      and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to
      and (not e.members_only or is_crew_full_member(c.id))
  ),
  races as (
    select 'race'::text, rp.race_date,
           case
             when rp.bib ~ '^\d{6}$'
                  and substring(rp.bib, 1, 2)::int < 24
                  and substring(rp.bib, 3, 2)::int < 60
             then (rp.race_date::timestamp
                   + make_interval(
                       hours => substring(rp.bib, 1, 2)::int,
                       mins  => substring(rp.bib, 3, 2)::int))
                  at time zone 'Asia/Seoul'
             else null
           end,
           rp.id, rp.title,
           coalesce(
             concat_ws(' · ', nullif(rp.division, ''), nullif(rp.note, '')),
             ''),
           rp.user_id, coalesce(pr.display_name, 'Athlete'),
           null::bigint, null::text,
           (select r.total_time_ms from race_results r
              where r.user_id = rp.user_id
                and r.event_date between rp.race_date - 3 and rp.race_date + 3
              order by r.total_time_ms asc nulls last
              limit 1),
           false
    from race_plans rp
    join crew_members m on m.user_id = rp.user_id and m.status = 'active'
    join c on c.id = m.crew_id
    join profiles pr on pr.id = rp.user_id
    where rp.race_date between p_from and p_to
  ),
  progs as (
    select pe.program_id, p.title as ptitle, pe.start_date as pstart,
           least(coalesce(pe.end_date, p_to), p_to) as pend,
           pe.repeat as repeat_enabled,
           (select max(d.day_index) from program_days d
              where d.program_id = p.id) as cyc
    from crew_program_enrollments pe
    join c on c.id = pe.crew_id
    join programs p on p.id = pe.program_id
  ),
  prog_days as (
    select pr.program_id, pr.ptitle, gs.d::date as on_date,
           case
             when pr.repeat_enabled and coalesce(pr.cyc, 0) > 0
               then ((gs.d::date - pr.pstart) % pr.cyc) + 1
             else (gs.d::date - pr.pstart) + 1
           end as day_idx
    from progs pr
    cross join lateral generate_series(
      greatest(pr.pstart, p_from)::timestamp,
      pr.pend::timestamp,
      interval '1 day'
    ) gs(d)
  ),
  program_rows as (
    select 'program'::text, pd.on_date, null::timestamptz, pd.program_id,
           pd.ptitle || ' D' || pd.day_idx,
           coalesce(d.focus, ''),
           null::uuid, null::text, null::bigint, null::text, null::bigint,
           false
    from prog_days pd
    join program_days d on d.program_id = pd.program_id and d.day_index = pd.day_idx
  )
  select * from meetups where exists (select 1 from ok)
  union all
  select * from races where exists (select 1 from ok)
  union all
  select * from program_rows where exists (select 1 from ok)
  order by on_date asc, starts_at asc nulls last;
$$;
grant execute on function public.crew_calendar(text, date, date) to anon, authenticated;

-- mcp_today: 반복·종료를 개인 바인딩에서 읽는다
create or replace function public.mcp_today(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  en as (
    select pe.start_date, pe.end_date, pe.repeat, p.id as pid, p.title,
           (select max(d.day_index) from program_days d where d.program_id = p.id) as cyc
    from program_enrollments pe join programs p on p.id = pe.program_id
    where pe.user_id = (select id from u) and pe.active limit 1),
  prog as (
    select e.pid, e.title,
      case
        when current_date < e.start_date then null
        when e.end_date is not null and current_date > e.end_date then null
        when e.repeat and coalesce(e.cyc, 0) > 0
          then ((current_date - e.start_date) % e.cyc) + 1
        when not e.repeat and (current_date - e.start_date) < coalesce(e.cyc, 0)
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
        and (not e.members_only or m.role <> 'associate')
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

-- program_calendar: 반복·종료를 바인딩에서 (소유자 등록 → 크루 연결 폴백)
create or replace function public.program_calendar(p_id uuid, p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_owner uuid;
  v_start date;
  v_end date;
  v_repeat boolean := false;
begin
  select owner_id into v_owner from programs
  where id = p_id and calendar_token = p_token;
  if v_owner is null then return null; end if;

  select en.start_date, en.end_date, en.repeat into v_start, v_end, v_repeat
  from program_enrollments en
  where en.program_id = p_id and en.user_id = v_owner and en.active
  order by en.created_at desc limit 1;
  if v_start is null then
    select ce.start_date, ce.end_date, ce.repeat into v_start, v_end, v_repeat
    from crew_program_enrollments ce
    where ce.program_id = p_id
    order by ce.created_at desc limit 1;
  end if;

  return (
    select jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'start_date', v_start,
      'end_date', v_end,
      'repeat_enabled', coalesce(v_repeat, false),
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id,
          'day_index', d.day_index,
          'focus', d.focus,
          'notes', d.notes,
          'workouts', coalesce((
            select jsonb_agg(jsonb_build_object(
              'title', w.title,
              'items', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'note', i.target->>'note',
                  'name_ko', e.name_ko,
                  'name_en', e.name_en
                ) order by i.seq)
                from workout_template_items i
                left join exercises e on e.id = i.exercise_id
                where i.template_id = w.id), '[]'::jsonb)
            ) order by w.created_at)
            from workout_templates w
            where w.program_day_id = d.id), '[]'::jsonb)
        ) order by d.day_index)
        from program_days d
        where d.program_id = p.id), '[]'::jsonb)
    )
    from programs p where p.id = p_id);
end;
$$;

-- mcp_my_programs / mcp_program: repeats → 내 바인딩(my_repeat·my_end_date)
create or replace function public.mcp_my_programs(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'weeks', p.weeks, 'level', p.level,
      'day_count', (select count(*) from program_days d where d.program_id = p.id),
      'my_start_date', en.start_date, 'my_end_date', en.end_date,
      'my_repeat', en.repeat,
      'crews', coalesce((select jsonb_agg(c.slug)
        from crew_program_enrollments e join crews c on c.id = e.crew_id
        where e.program_id = p.id), '[]'::jsonb)
    ) order by p.created_at desc)
    from programs p
    left join lateral (
      select e2.start_date, e2.end_date, e2.repeat from program_enrollments e2
      where e2.program_id = p.id and e2.user_id = v_uid and e2.active
      order by e2.created_at desc limit 1) en on true
    where p.owner_id = v_uid), '[]'::jsonb);
end; $$;

create or replace function public.mcp_program(p_token text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return (
    select jsonb_build_object(
      'id', p.id, 'title', p.title, 'description', p.description,
      'weeks', p.weeks, 'level', p.level,
      'my_start_date', (select en.start_date from program_enrollments en
        where en.program_id = p.id and en.user_id = v_uid and en.active
        order by en.created_at desc limit 1),
      'days', coalesce((select jsonb_agg(jsonb_build_object(
          'day_index', d.day_index, 'focus', d.focus, 'notes', d.notes)
          order by d.day_index)
        from program_days d where d.program_id = p.id), '[]'::jsonb))
    from programs p
    where p.id = p_id and (
      p.owner_id = v_uid or p.is_public or exists (
        select 1 from crew_program_enrollments e
        join crew_members m on m.crew_id = e.crew_id
          and m.user_id = v_uid and m.status = 'active'
        where e.program_id = p.id)));
end; $$;

-- mcp_create_program: 템플릿에 반복 없음 (시그니처 변경 → 구버전 제거)
drop function if exists public.mcp_create_program(text, text, int, jsonb, text, text, boolean);
create function public.mcp_create_program(
  p_token text, p_title text, p_weeks int, p_days jsonb,
  p_level text default 'intermediate', p_description text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_id uuid;
  v_n int := 0;
  d jsonb;
  v_idx int;
begin
  if v_uid is null then return null; end if;
  if p_title is null or length(trim(p_title)) = 0
     or p_weeks is null or p_weeks < 1 or p_weeks > 20
     or p_level not in ('beginner', 'intermediate', 'advanced', 'elite')
     or p_days is null or jsonb_typeof(p_days) <> 'array'
     or jsonb_array_length(p_days) = 0 or jsonb_array_length(p_days) > 140 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  insert into programs (owner_id, title, description, weeks, level, is_public)
  values (v_uid, left(trim(p_title), 120),
          nullif(left(trim(coalesce(p_description, '')), 2000), ''),
          p_weeks, p_level, false)
  returning id into v_id;

  for d in select * from jsonb_array_elements(p_days) loop
    v_idx := (d->>'day_index')::int;
    if v_idx is null or v_idx < 1 or v_idx > p_weeks * 7 then
      continue;
    end if;
    insert into program_days (program_id, day_index, focus, notes)
    values (v_id, v_idx,
            nullif(left(trim(coalesce(d->>'focus', '')), 200), ''),
            nullif(left(trim(coalesce(d->>'notes', '')), 2000), ''));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'program_id', v_id,
    'title', left(trim(p_title), 120), 'days_created', v_n,
    'note', '프로그램은 템플릿입니다 — 시작일·반복은 웹 시작 모달(개인) 또는 attach_crew_program(크루)에서 정합니다.');
end; $$;
grant execute on function
  public.mcp_create_program(text, text, int, jsonb, text, text)
to anon, authenticated;

-- mcp_attach_crew_program: 반복 옵션 추가 (시그니처 변경 → 구버전 제거)
drop function if exists public.mcp_attach_crew_program(text, text, uuid, date, date);
create function public.mcp_attach_crew_program(
  p_token text, p_slug text, p_program uuid,
  p_start_date date default current_date, p_end_date date default null,
  p_repeat boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_uid uuid := mcp_uid(p_token);
begin
  if v_crew is null then return null; end if;
  if not exists (select 1 from programs p
                 where p.id = p_program and (p.owner_id = v_uid or p.is_public)) then
    return jsonb_build_object('error', 'program_not_found_or_not_yours');
  end if;
  insert into crew_program_enrollments
    (crew_id, program_id, start_date, end_date, repeat, created_by)
  values (v_crew, p_program, coalesce(p_start_date, current_date), p_end_date,
          coalesce(p_repeat, false), v_uid)
  on conflict (crew_id, program_id) do update
    set start_date = excluded.start_date, end_date = excluded.end_date,
        repeat = excluded.repeat;
  return jsonb_build_object('ok', true, 'crew', p_slug, 'program_id', p_program,
    'start_date', coalesce(p_start_date, current_date), 'end_date', p_end_date,
    'repeat', coalesce(p_repeat, false));
end; $$;
grant execute on function
  public.mcp_attach_crew_program(text, text, uuid, date, date, boolean)
to anon, authenticated;

-- 템플릿에서 반복 플래그 제거
alter table public.programs drop column if exists repeat_enabled;
