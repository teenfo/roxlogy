-- ============================================================
-- Roxlogy — 프로그램 날짜를 바인딩으로 이관
--
-- 프로그램은 그 자체로 훈련 템플릿이다. 시작/종료일은 프로그램이 아니라
-- "누가 언제 하느냐"의 속성이므로 바인딩에만 둔다:
--   개인 = program_enrollments.start_date (등록 모달에서 선택)
--   크루 = crew_program_enrollments.start_date/end_date
-- programs.start_date/end_date 컬럼을 제거하고, 이를 참조하던
-- 함수(program_calendar·mcp_*)를 바인딩 기준으로 재작성한다.
-- 종료 판정은 "일차 > 프로그램 길이(max day_index)" 규칙으로 통일,
-- 반복 프로그램은 중지할 때까지 무기한 순환한다.
-- ============================================================

-- 1) 캘린더 구독 RPC: 소유자의 활성 등록 → 없으면 크루 연결에서 날짜를 얻는다
create or replace function public.program_calendar(p_id uuid, p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_owner uuid;
  v_start date;
  v_end date;
begin
  select owner_id into v_owner from programs
  where id = p_id and calendar_token = p_token;
  if v_owner is null then return null; end if;

  select en.start_date into v_start from program_enrollments en
  where en.program_id = p_id and en.user_id = v_owner and en.active
  order by en.created_at desc limit 1;
  if v_start is null then
    select ce.start_date, ce.end_date into v_start, v_end
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
      'repeat_enabled', p.repeat_enabled,
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

-- 2) mcp_today: programs.end_date 의존 제거 — 길이 규칙으로만 종료 판정
create or replace function public.mcp_today(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  en as (
    select pe.start_date, p.id as pid, p.title, p.repeat_enabled,
           (select max(d.day_index) from program_days d where d.program_id = p.id) as cyc
    from program_enrollments pe join programs p on p.id = pe.program_id
    where pe.user_id = (select id from u) and pe.active limit 1),
  prog as (
    select e.pid, e.title,
      case
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

-- 3) mcp_my_programs / mcp_program: 프로그램 자체 날짜 제거, 내 등록일 노출
create or replace function public.mcp_my_programs(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'weeks', p.weeks, 'level', p.level,
      'repeats', p.repeat_enabled,
      'day_count', (select count(*) from program_days d where d.program_id = p.id),
      'my_start_date', (select en.start_date from program_enrollments en
        where en.program_id = p.id and en.user_id = v_uid and en.active
        order by en.created_at desc limit 1),
      'crews', coalesce((select jsonb_agg(c.slug)
        from crew_program_enrollments e join crews c on c.id = e.crew_id
        where e.program_id = p.id), '[]'::jsonb)
    ) order by p.created_at desc)
    from programs p where p.owner_id = v_uid), '[]'::jsonb);
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
      'repeats', p.repeat_enabled,
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

-- 4) mcp_create_program: 프로그램에 날짜를 넣지 않는다 (시그니처 변경 → 구버전 제거)
drop function if exists public.mcp_create_program(text, text, int, jsonb, text, text, date, boolean);
create function public.mcp_create_program(
  p_token text, p_title text, p_weeks int, p_days jsonb,
  p_level text default 'intermediate', p_description text default null,
  p_repeat boolean default false
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

  insert into programs (owner_id, title, description, weeks, level,
                        repeat_enabled, is_public)
  values (v_uid, left(trim(p_title), 120),
          nullif(left(trim(coalesce(p_description, '')), 2000), ''),
          p_weeks, p_level, coalesce(p_repeat, false), false)
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
    'note', '프로그램은 템플릿입니다 — 일정 시작은 웹의 시작 버튼(개인) 또는 attach_crew_program(크루)으로 날짜를 바인딩하세요.');
end; $$;
grant execute on function
  public.mcp_create_program(text, text, int, jsonb, text, text, boolean)
to anon, authenticated;

-- 5) 컬럼 제거 — 프로그램은 이제 순수 템플릿
alter table public.programs drop column if exists start_date;
alter table public.programs drop column if exists end_date;
