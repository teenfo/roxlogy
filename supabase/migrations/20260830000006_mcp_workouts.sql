-- ============================================================
-- Roxlogy — MCP 프로그램에 구조화 워크아웃 + 운동 등록 요청
--
-- 1) mcp_exercises: 운동 DB 목록 (AI 가 유효한 운동을 먼저 확인)
-- 2) create_program / set_program_day 의 일차에 workouts 지원 —
--    아이템의 exercise 는 운동 DB(name_ko/name_en) 매칭만 허용,
--    미등록 이름은 전체 거부(unknown_exercises)로 알려준다
-- 3) exercise_requests: DB 에 없는 운동의 등록 요청 (관리자 승인)
-- ============================================================

-- ---------- 운동 등록 요청
create table if not exists public.exercise_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  name_ko text not null check (char_length(name_ko) between 1 and 60),
  name_en text check (name_en is null or char_length(name_en) <= 60),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

alter table public.exercise_requests enable row level security;
create policy exercise_requests_select on public.exercise_requests
  for select using (requested_by = auth.uid() or is_admin());
create policy exercise_requests_insert on public.exercise_requests
  for insert with check (requested_by = auth.uid());
create policy exercise_requests_admin_update on public.exercise_requests
  for update using (is_admin()) with check (is_admin());

-- ---------- 운동 이름 → id (한/영, 대소문자·공백 무시)
create or replace function public.resolve_exercise(p_name text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select id from exercises
  where lower(trim(name_ko)) = lower(trim(p_name))
     or lower(trim(name_en)) = lower(trim(p_name))
  limit 1;
$$;

-- ---------- 운동 DB 목록
create or replace function public.mcp_exercises(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if mcp_uid(p_token) is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'name_ko', e.name_ko, 'name_en', e.name_en,
      'station_type', e.station_type, 'category', e.category)
      order by e.station_type nulls last, e.name_ko)
    from exercises e), '[]'::jsonb);
end; $$;

-- ---------- 운동 등록 요청 (+ 내 요청 상태)
create or replace function public.mcp_request_exercise(
  p_token text, p_name_ko text, p_name_en text default null,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_exist uuid;
  v_id uuid;
begin
  if v_uid is null then return null; end if;
  if p_name_ko is null or length(trim(p_name_ko)) = 0 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  v_exist := resolve_exercise(p_name_ko);
  if v_exist is null and p_name_en is not null then
    v_exist := resolve_exercise(p_name_en);
  end if;
  if v_exist is not null then
    return jsonb_build_object('already_exists', true,
      'name', (select name_ko from exercises where id = v_exist));
  end if;
  if exists (select 1 from exercise_requests r
    where r.status = 'pending'
      and lower(trim(r.name_ko)) = lower(trim(p_name_ko))) then
    return jsonb_build_object('ok', true, 'already_requested', true);
  end if;
  insert into exercise_requests (requested_by, name_ko, name_en, note)
  values (v_uid, left(trim(p_name_ko), 60),
          nullif(left(trim(coalesce(p_name_en, '')), 60), ''),
          nullif(left(trim(coalesce(p_note, '')), 300), ''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id,
    'status', 'pending',
    'note', '관리자 승인 후 운동 DB 에 추가됩니다 — 승인 전에는 프로그램 워크아웃에 쓸 수 없습니다.');
end; $$;

-- ---------- 일차 workouts 검증+생성 공용 헬퍼
-- 반환: null = 성공, jsonb = 오류
create or replace function public._mcp_insert_workouts(p_day_id uuid, p_workouts jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  w jsonb;
  it jsonb;
  v_tid uuid;
  v_eid uuid;
  v_seq int;
  v_type text;
  v_unknown text[] := '{}';
  v_name text;
begin
  if p_workouts is null or jsonb_typeof(p_workouts) <> 'array' then
    return null;
  end if;
  if jsonb_array_length(p_workouts) > 5 then
    return jsonb_build_object('error', 'too_many_workouts');
  end if;

  -- 1차: 운동 이름 전부 검증
  for w in select * from jsonb_array_elements(p_workouts) loop
    if jsonb_typeof(w->'items') <> 'array'
       or jsonb_array_length(w->'items') = 0
       or jsonb_array_length(w->'items') > 15 then
      return jsonb_build_object('error', 'invalid_items');
    end if;
    for it in select * from jsonb_array_elements(w->'items') loop
      v_name := trim(coalesce(it->>'exercise', ''));
      if v_name = '' then
        return jsonb_build_object('error', 'missing_exercise_name');
      end if;
      if resolve_exercise(v_name) is null
         and not (v_name = any(v_unknown)) then
        v_unknown := v_unknown || v_name;
      end if;
    end loop;
  end loop;
  if array_length(v_unknown, 1) > 0 then
    return jsonb_build_object('error', 'unknown_exercises',
      'unknown', to_jsonb(v_unknown),
      'hint', 'list_exercises 로 등록된 운동을 확인하거나, 없는 운동은 request_exercise 로 등록을 요청하세요.');
  end if;

  -- 2차: 생성
  for w in select * from jsonb_array_elements(p_workouts) loop
    v_type := case when w->>'type' in ('race_sim','wod','run','strength')
                   then w->>'type' else 'wod' end;
    insert into workout_templates (program_day_id, title, type, structure)
    values (p_day_id,
            coalesce(nullif(left(trim(coalesce(w->>'title', '')), 80), ''), 'WOD'),
            v_type, '{}'::jsonb)
    returning id into v_tid;
    v_seq := 0;
    for it in select * from jsonb_array_elements(w->'items') loop
      v_seq := v_seq + 1;
      v_eid := resolve_exercise(trim(it->>'exercise'));
      insert into workout_template_items (template_id, seq, exercise_id, target)
      values (v_tid, v_seq, v_eid,
              case when nullif(trim(coalesce(it->>'note', '')), '') is not null
                   then jsonb_build_object('note', left(trim(it->>'note'), 80))
                   else null end);
    end loop;
  end loop;
  return null;
end; $$;

-- ---------- create_program: days[].workouts 지원 (시그니처 동일 → replace)
create or replace function public.mcp_create_program(
  p_token text, p_title text, p_weeks int, p_days jsonb,
  p_level text default 'intermediate', p_description text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_id uuid;
  v_day_id uuid;
  v_n int := 0;
  v_w int := 0;
  d jsonb;
  v_idx int;
  v_err jsonb;
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
            nullif(left(trim(coalesce(d->>'notes', '')), 2000), ''))
    returning id into v_day_id;
    v_n := v_n + 1;

    if d ? 'workouts' then
      v_err := _mcp_insert_workouts(v_day_id, d->'workouts');
      if v_err is not null then
        raise exception 'MCP_WORKOUT_ERR %', v_err::text
          using errcode = 'P0001';
      end if;
      v_w := v_w + jsonb_array_length(d->'workouts');
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'program_id', v_id,
    'title', left(trim(p_title), 120), 'days_created', v_n,
    'workouts_created', v_w,
    'note', '프로그램은 템플릿입니다 — 시작일·반복은 웹 시작 모달(개인) 또는 attach_crew_program(크루)에서 정합니다.');
exception
  when others then
    -- 미등록 운동 등 워크아웃 오류: 전체 롤백 후 구조화된 오류 반환
    if sqlerrm like 'MCP_WORKOUT_ERR %' then
      return substring(sqlerrm from 17)::jsonb;
    end if;
    raise;
end; $$;

-- ---------- set_program_day: p_workouts 로 그 일차 워크아웃 교체 (시그니처 변경)
drop function if exists public.mcp_set_program_day(text, uuid, int, text, text);
create function public.mcp_set_program_day(
  p_token text, p_program uuid, p_day_index int,
  p_focus text default null, p_notes text default null,
  p_workouts jsonb default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_weeks int;
  v_day_id uuid;
  v_err jsonb;
begin
  if v_uid is null then return null; end if;
  select weeks into v_weeks from programs
  where id = p_program and owner_id = v_uid;
  if v_weeks is null then return null; end if;
  if p_day_index is null or p_day_index < 1 or p_day_index > v_weeks * 7 then
    return jsonb_build_object('error', 'invalid_day_index');
  end if;

  if p_focus is null and p_notes is null and p_workouts is null then
    delete from program_days where program_id = p_program and day_index = p_day_index;
    return jsonb_build_object('ok', true, 'day_index', p_day_index, 'deleted', true);
  end if;

  select id into v_day_id from program_days
  where program_id = p_program and day_index = p_day_index;
  if v_day_id is null then
    insert into program_days (program_id, day_index, focus, notes)
    values (p_program, p_day_index,
            nullif(left(trim(coalesce(p_focus, '')), 200), ''),
            nullif(left(trim(coalesce(p_notes, '')), 2000), ''))
    returning id into v_day_id;
  else
    update program_days
    set focus = case when p_focus is null then focus
                     else nullif(left(trim(p_focus), 200), '') end,
        notes = case when p_notes is null then notes
                     else nullif(left(trim(p_notes), 2000), '') end
    where id = v_day_id;
  end if;

  if p_workouts is not null then
    -- 교체: 기존 워크아웃 삭제 후 재생성 (검증 실패 시 예외 → 블록 전체 롤백)
    delete from workout_templates where program_day_id = v_day_id;
    v_err := _mcp_insert_workouts(v_day_id, p_workouts);
    if v_err is not null then
      raise exception 'MCP_WORKOUT_ERR %', v_err::text using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'day_index', p_day_index,
    'workouts', case when p_workouts is null then null
                     else jsonb_array_length(p_workouts) end);
exception
  when others then
    if sqlerrm like 'MCP_WORKOUT_ERR %' then
      return substring(sqlerrm from 17)::jsonb;
    end if;
    raise;
end; $$;

grant execute on function
  public.mcp_exercises(text),
  public.mcp_request_exercise(text, text, text, text),
  public.mcp_set_program_day(text, uuid, int, text, text, jsonb)
to anon, authenticated;
