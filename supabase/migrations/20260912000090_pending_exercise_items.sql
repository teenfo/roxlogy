-- ============================================================
-- Roxlogy — 미등록 운동을 "승인 대기 항목"으로 저장하고, 승인되면 자동으로 채운다
--
-- 배경
--   운동 DB 에 없는 이름은 MCP 가 프로그램 전체를 거부(unknown_exercises)했고, 웹 빌더는
--   항목을 붙일 수 없었다. AI 경로만 exercise_id 없이 이름을 note 에 두고 지나갔다(088·089).
--   세 경로 모두 "요청은 남지만 승인 뒤 프로그램을 다시 열어 고쳐야" 했다.
--
-- 설계 (등록 요청 행을 껍데기로 쓴다)
--   1) workout_template_items.exercise_request_id + pending_exercise —
--      미등록 운동은 항목을 만들되 exercise_id 는 비우고, 이름과 요청 id 를 여기 둔다.
--   2) ensure_exercise_request(owner, name, note) — pending 요청 중 이름(norm_exname)이
--      같은 것이 있으면 그 id, 없으면 새로 만들어 id. 누가 냈든 이름으로 합쳐진다.
--   3) 승인 → exercise_requests.status='approved' + resolved_exercise_id 가 채워지면
--      AFTER UPDATE 트리거가 그 요청을 가리키던 모든 항목의 exercise_id 를 채운다.
--      resolved_exercise_id 없이 approved 만 찍혀도(옛 어드민 경로) resolve_exercise(name_ko)
--      로 찾아 채운다. 거절은 항목을 건드리지 않는다(이름·요청 참조 그대로).
--   4) approve_exercise_request(request, exercise?, name_en?) — 관리자 RPC.
--      exercise 를 주면 새로 만들지 않고 기존 운동에 연결 + 별칭 추가(다음부터 바로 매칭).
--      reject_exercise_request(request) — 관리자 RPC.
--   5) request_exercise_placeholder(name) — 웹 빌더용(authenticated). 2) 를 본인 소유로
--      감싼 것. 반환 id 를 항목 insert 에 쓴다.
--   6) _mcp_insert_workouts(day, workouts, owner, confirm_unknown) — 미등록 이름을
--      항목으로 저장한다. 단, 유사 후보가 있는 이름은 confirm_unknown=false 면 전처럼
--      unknown_exercises 로 돌려준다(오타를 그대로 저장하지 않게 AI 가 사용자에게 확인).
--      후보가 없는 이름은 바로 대기 항목이 된다. 반환값에 pending 목록을 실어 준다.
--      mcp_create_program / mcp_set_program_day 에 p_confirm_unknown 인자 추가(drop+create).
--   7) ai_materialize_program — 대기 항목에 요청 id·이름을 채운다(note 에 이름 중복 X).
--   8) program_calendar / mcp_program — 대기 항목 이름을 돌려준다.
--
-- 되돌리기: 트리거·RPC drop, 컬럼 drop, 082/085/089 의 함수 정의 재적용.
-- ============================================================

-- 1) 컬럼 ------------------------------------------------------------------
alter table public.workout_template_items
  add column if not exists exercise_request_id uuid
    references public.exercise_requests(id) on delete set null,
  add column if not exists pending_exercise text
    check (pending_exercise is null or char_length(pending_exercise) between 1 and 60);
create index if not exists idx_wti_exercise_request
  on public.workout_template_items(exercise_request_id)
  where exercise_request_id is not null;
comment on column public.workout_template_items.exercise_request_id is
  '미등록 운동 항목이 기다리는 등록 요청. 승인되면 트리거가 exercise_id 를 채운다.';
comment on column public.workout_template_items.pending_exercise is
  '미등록 운동의 입력 이름(승인 대기 표시용). exercise_id 가 채워지면 null.';

alter table public.exercise_requests
  add column if not exists resolved_exercise_id uuid references public.exercises(id) on delete set null;
comment on column public.exercise_requests.resolved_exercise_id is
  '승인 시 만들어졌거나 연결된 운동. 트리거가 이 값으로 대기 항목을 채운다.';

-- 2) 요청 확보(중복 합침) — 내부용 -------------------------------------------
create or replace function public.ensure_exercise_request(
  p_owner uuid, p_name text, p_note text default null
)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_name text := left(trim(coalesce(p_name, '')), 60);
begin
  if p_owner is null or v_name = '' then return null; end if;
  select id into v_id from exercise_requests
   where status = 'pending' and norm_exname(name_ko) = norm_exname(v_name)
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into exercise_requests (requested_by, name_ko, note)
  values (p_owner, v_name, nullif(left(trim(coalesce(p_note, '')), 300), ''))
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.ensure_exercise_request(uuid, text, text) from public, anon, authenticated;

-- 5) 웹 빌더용 — 본인 소유로 요청 확보 -----------------------------------------
create or replace function public.request_exercise_placeholder(p_name text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if not exists (select 1 from profiles where id = v_uid and not disabled) then
    raise exception 'account_disabled' using errcode = '42501';
  end if;
  if resolve_exercise(p_name) is not null then
    raise exception 'exercise_exists';
  end if;
  return ensure_exercise_request(v_uid, p_name, null);
end; $$;
revoke all on function public.request_exercise_placeholder(text) from public;
grant execute on function public.request_exercise_placeholder(text) to authenticated;

-- 3) 승인 시 항목 채우기 트리거 ---------------------------------------------
create or replace function public.exercise_requests_fill_items() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_ex uuid;
begin
  if new.status <> 'approved' or old.status = 'approved' then return null; end if;
  v_ex := coalesce(new.resolved_exercise_id, resolve_exercise(new.name_ko));
  if v_ex is null then return null; end if;
  if new.resolved_exercise_id is null then
    update exercise_requests set resolved_exercise_id = v_ex where id = new.id;
  end if;
  update workout_template_items
     set exercise_id = v_ex, pending_exercise = null
   where exercise_request_id = new.id and exercise_id is null;
  return null;
end; $$;
revoke all on function public.exercise_requests_fill_items() from public, anon, authenticated;
drop trigger if exists exercise_requests_fill_items on public.exercise_requests;
create trigger exercise_requests_fill_items
  after update of status on public.exercise_requests
  for each row execute function public.exercise_requests_fill_items();

-- 4) 관리자 승인/거절 RPC -----------------------------------------------------
create or replace function public.approve_exercise_request(
  p_request uuid, p_exercise uuid default null, p_name_en text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_ex uuid; v_n int;
begin
  if not is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into r from exercise_requests where id = p_request;
  if r.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('error', 'already_resolved', 'status', r.status); end if;

  if p_exercise is not null then
    -- 기존 운동에 연결 + 요청 이름을 별칭으로 (이미 같은 이름이면 추가하지 않음)
    if not exists (select 1 from exercises where id = p_exercise) then
      return jsonb_build_object('error', 'exercise_not_found');
    end if;
    v_ex := p_exercise;
    update exercises e
       set aliases = array_append(e.aliases, r.name_ko)
     where e.id = v_ex
       and norm_exname(e.name_ko) <> norm_exname(r.name_ko)
       and norm_exname(e.name_en) <> norm_exname(r.name_ko)
       and not exists (select 1 from unnest(e.aliases) a where norm_exname(a) = norm_exname(r.name_ko));
  else
    v_ex := resolve_exercise(r.name_ko);
    if v_ex is null then
      insert into exercises (name_ko, name_en)
      values (r.name_ko, coalesce(nullif(left(trim(coalesce(p_name_en, '')), 60), ''), r.name_ko))
      returning id into v_ex;
    end if;
  end if;

  update exercise_requests
     set status = 'approved', resolved_exercise_id = v_ex,
         resolved_at = now(), resolved_by = auth.uid()
   where id = p_request;
  select count(*) into v_n from workout_template_items where exercise_request_id = p_request and exercise_id = v_ex;
  return jsonb_build_object('ok', true, 'exercise_id', v_ex, 'items_filled', v_n);
end; $$;
revoke all on function public.approve_exercise_request(uuid, uuid, text) from public;
grant execute on function public.approve_exercise_request(uuid, uuid, text) to authenticated;

create or replace function public.reject_exercise_request(p_request uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if not is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  update exercise_requests
     set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
   where id = p_request and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('error', 'not_found_or_resolved'); end if;
  -- 대기 항목은 그대로 둔다(이름·요청 참조 유지) — 사용자가 직접 바꾸거나 나중에 다시 요청.
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.reject_exercise_request(uuid) from public;
grant execute on function public.reject_exercise_request(uuid) to authenticated;

-- 6) MCP 워크아웃 저장 — 미등록 운동을 대기 항목으로 --------------------------
drop function if exists public._mcp_insert_workouts(uuid, jsonb);
create function public._mcp_insert_workouts(
  p_day_id uuid, p_workouts jsonb, p_owner uuid, p_confirm_unknown boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  w jsonb; it jsonb;
  v_tid uuid; v_eid uuid; v_rid uuid; v_seq int; v_type text;
  v_unknown text[] := '{}';       -- 유사 후보가 있어 확인이 필요한 이름
  v_pending text[] := '{}';       -- 대기 항목으로 저장한 이름
  v_sugs jsonb := '{}'::jsonb; v_s jsonb;
  v_name text; v_target jsonb; v_title text;
begin
  if p_workouts is null or jsonb_typeof(p_workouts) <> 'array' then
    return null;
  end if;
  if jsonb_array_length(p_workouts) > 5 then
    return jsonb_build_object('error', 'too_many_workouts');
  end if;

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
      if char_length(v_name) > 60 then
        return jsonb_build_object('error', 'exercise_name_too_long', 'exercise', v_name);
      end if;
      if resolve_exercise(v_name) is null and not (v_name = any(v_unknown)) then
        v_s := suggest_exercises(v_name);
        -- 유사 후보가 있으면 오타일 수 있다 — confirm_unknown 없이는 저장하지 않는다
        if not coalesce(p_confirm_unknown, false) and jsonb_array_length(v_s) > 0 then
          v_unknown := v_unknown || v_name;
          v_sugs := v_sugs || jsonb_build_object(v_name, v_s);
        end if;
      end if;
      if (it ? 'distance_m') and ((it->>'distance_m')::numeric < 1
          or (it->>'distance_m')::numeric > 200000) then
        return jsonb_build_object('error', 'invalid_target', 'field', 'distance_m');
      end if;
      if (it ? 'weight_kg') and ((it->>'weight_kg')::numeric <= 0
          or (it->>'weight_kg')::numeric > 1000) then
        return jsonb_build_object('error', 'invalid_target', 'field', 'weight_kg');
      end if;
      if (it ? 'reps') and ((it->>'reps')::numeric < 1
          or (it->>'reps')::numeric > 10000) then
        return jsonb_build_object('error', 'invalid_target', 'field', 'reps');
      end if;
      if (it ? 'sets') and ((it->>'sets')::numeric < 1
          or (it->>'sets')::numeric > 100) then
        return jsonb_build_object('error', 'invalid_target', 'field', 'sets');
      end if;
      if (it ? 'duration_s') and ((it->>'duration_s')::numeric < 1
          or (it->>'duration_s')::numeric > 86400) then
        return jsonb_build_object('error', 'invalid_target', 'field', 'duration_s');
      end if;
      if (it ? 'rest_s') and ((it->>'rest_s')::numeric < 1
          or (it->>'rest_s')::numeric > 3600) then
        return jsonb_build_object('error', 'invalid_target', 'field', 'rest_s');
      end if;
    end loop;
  end loop;
  if array_length(v_unknown, 1) > 0 then
    return jsonb_build_object('error', 'unknown_exercises',
      'unknown', to_jsonb(v_unknown),
      'suggestions', v_sugs,
      'hint', 'suggestions 의 후보가 같은 운동이면 사용자에게 확인 후 그 이름으로 재시도하세요. 정말 다른 새 운동이면 confirm_unknown=true 로 재시도 — 그 운동은 "승인 대기" 항목으로 저장되고 등록 요청이 자동으로 남으며, 관리자가 승인하면 항목이 자동으로 채워집니다.');
  end if;

  select left(p.title, 80) into v_title
    from program_days d join programs p on p.id = d.program_id where d.id = p_day_id;

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
      v_name := trim(it->>'exercise');
      v_eid := resolve_exercise(v_name);
      v_rid := null;
      if v_eid is null then
        v_rid := ensure_exercise_request(p_owner, v_name,
                   'MCP 프로그램 등록에서 자동 요청' || coalesce(' — ' || v_title, ''));
        if not (v_name = any(v_pending)) then v_pending := v_pending || v_name; end if;
      end if;
      v_target := jsonb_strip_nulls(jsonb_build_object(
        'distance_m', round((it->>'distance_m')::numeric)::int,
        'weight_kg', (it->>'weight_kg')::numeric,
        'reps', round((it->>'reps')::numeric)::int,
        'sets', round((it->>'sets')::numeric)::int,
        'duration_s', round((it->>'duration_s')::numeric)::int,
        'rest_s', round((it->>'rest_s')::numeric)::int,
        'note', nullif(left(trim(coalesce(it->>'note', '')), 80), '')));
      insert into workout_template_items
        (template_id, seq, exercise_id, target, exercise_request_id, pending_exercise)
      values (v_tid, v_seq, v_eid,
              case when v_target = '{}'::jsonb then null else v_target end,
              v_rid, case when v_eid is null then left(v_name, 60) end);
    end loop;
  end loop;
  -- 오류 없음. 대기 항목이 있으면 알려 준다(호출자가 응답에 합친다).
  if array_length(v_pending, 1) > 0 then
    return jsonb_build_object('pending_exercises', to_jsonb(v_pending));
  end if;
  return null;
end; $$;
revoke all on function public._mcp_insert_workouts(uuid, jsonb, uuid, boolean) from public, anon, authenticated;

-- 6a) mcp_create_program — p_confirm_unknown 추가 (인자 변경이라 drop+create)
drop function if exists public.mcp_create_program(text, text, integer, jsonb, text, text, integer[]);
create function public.mcp_create_program(
  p_token text, p_title text, p_weeks integer, p_days jsonb,
  p_level text default 'intermediate', p_description text default null,
  p_week_pattern integer[] default null, p_confirm_unknown boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_id uuid; v_n int := 0; v_w int := 0;
  d jsonb; v_idx int; v_day_id uuid; v_err jsonb;
  v_pat smallint[]; v_pending jsonb := '[]'::jsonb;
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
  if p_title is null or length(trim(p_title)) = 0
     or p_weeks is null or p_weeks < 1 or p_weeks > 20
     or p_level not in ('beginner', 'intermediate', 'advanced', 'elite')
     or p_days is null or jsonb_typeof(p_days) <> 'array'
     or jsonb_array_length(p_days) = 0 or jsonb_array_length(p_days) > 140 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  if p_week_pattern is not null then
    if array_length(p_week_pattern, 1) is null
       or array_length(p_week_pattern, 1) > 7
       or exists (select 1 from unnest(p_week_pattern) x where x < 0 or x > 6) then
      return jsonb_build_object('error', 'invalid_week_pattern',
        'hint', 'week_pattern 은 0(월)~6(일) 요일 번호 배열입니다. 예: [0,2,4] = 월·수·금');
    end if;
    v_pat := p_week_pattern::smallint[];
  end if;
  for d in select * from jsonb_array_elements(p_days) loop
    v_idx := (d->>'day_index')::int;
    if v_idx is null or v_idx < 1 or v_idx > p_weeks * 7 then
      return jsonb_build_object('error', 'invalid_day_index',
        'day_index', d->>'day_index', 'max', p_weeks * 7,
        'hint', 'day_index 는 1 부터 weeks×7 사이여야 합니다. weeks 를 늘리거나 일차를 조정하세요.');
    end if;
  end loop;
  insert into programs (owner_id, title, description, weeks, level, is_public, week_pattern)
  values (v_uid, left(trim(p_title), 120),
          nullif(left(trim(coalesce(p_description, '')), 2000), ''),
          p_weeks, p_level, false, v_pat)
  returning id into v_id;
  for d in select * from jsonb_array_elements(p_days) loop
    v_idx := (d->>'day_index')::int;
    insert into program_days (program_id, day_index, focus, notes)
    values (v_id, v_idx,
            nullif(left(trim(coalesce(d->>'focus', '')), 200), ''),
            nullif(left(trim(coalesce(d->>'notes', '')), 2000), ''))
    returning id into v_day_id;
    v_n := v_n + 1;
    if d ? 'workouts' then
      v_err := _mcp_insert_workouts(v_day_id, d->'workouts', v_uid, p_confirm_unknown);
      if v_err ? 'error' then
        raise exception 'MCP_WORKOUT_ERR %', v_err::text using errcode = 'P0001';
      end if;
      if v_err ? 'pending_exercises' then
        select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_pending
          from jsonb_array_elements(v_pending || (v_err->'pending_exercises')) x;
      end if;
      v_w := v_w + jsonb_array_length(d->'workouts');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'program_id', v_id,
    'title', left(trim(p_title), 120), 'days_created', v_n,
    'workouts_created', v_w, 'week_pattern', v_pat,
    'note', '프로그램은 템플릿입니다 — 시작일·반복은 웹 시작 모달(개인) 또는 attach_crew_program(크루)에서 정합니다.')
    || case when jsonb_array_length(v_pending) > 0 then jsonb_build_object(
         'pending_exercises', v_pending,
         'pending_note', '운동 DB 에 없는 운동은 "승인 대기" 항목으로 저장됐고 등록 요청이 자동으로 남았습니다. 관리자가 승인하면 항목이 자동으로 채워집니다 — 사용자에게 알려 주세요.')
       else '{}'::jsonb end;
exception
  when others then
    if sqlerrm like 'MCP_WORKOUT_ERR %' then
      return substring(sqlerrm from 17)::jsonb;
    end if;
    raise;
end; $$;
revoke all on function public.mcp_create_program(text, text, integer, jsonb, text, text, integer[], boolean) from public;
grant execute on function public.mcp_create_program(text, text, integer, jsonb, text, text, integer[], boolean) to anon, authenticated;

-- 6b) mcp_set_program_day — p_confirm_unknown 추가
drop function if exists public.mcp_set_program_day(text, uuid, integer, text, text, jsonb);
create function public.mcp_set_program_day(
  p_token text, p_program uuid, p_day_index integer,
  p_focus text default null, p_notes text default null, p_workouts jsonb default null,
  p_confirm_unknown boolean default false
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
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
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
    delete from workout_templates where program_day_id = v_day_id;
    v_err := _mcp_insert_workouts(v_day_id, p_workouts, v_uid, p_confirm_unknown);
    if v_err ? 'error' then
      raise exception 'MCP_WORKOUT_ERR %', v_err::text using errcode = 'P0001';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'day_index', p_day_index,
    'workouts', case when p_workouts is null then null
                     else jsonb_array_length(p_workouts) end)
    || case when v_err ? 'pending_exercises' then jsonb_build_object(
         'pending_exercises', v_err->'pending_exercises',
         'pending_note', '운동 DB 에 없는 운동은 "승인 대기" 항목으로 저장됐고 등록 요청이 자동으로 남았습니다. 관리자가 승인하면 항목이 자동으로 채워집니다 — 사용자에게 알려 주세요.')
       else '{}'::jsonb end;
exception
  when others then
    if sqlerrm like 'MCP_WORKOUT_ERR %' then
      return substring(sqlerrm from 17)::jsonb;
    end if;
    raise;
end; $$;
revoke all on function public.mcp_set_program_day(text, uuid, integer, text, text, jsonb, boolean) from public;
grant execute on function public.mcp_set_program_day(text, uuid, integer, text, text, jsonb, boolean) to anon, authenticated;

-- 7) AI 실체화 — 대기 항목에 요청 id·이름 기록 ---------------------------------
create or replace function public.ai_materialize_program(
  p_owner uuid, p_program jsonb, p_job_id uuid
)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid; v_title text; v_level text;
  d jsonb; it jsonb;
  v_idx_txt text; v_idx int; v_seen int[] := '{}'; v_days int := 0;
  v_day_id uuid; v_tid uuid; v_items jsonb; v_seq int;
  v_name text; v_eid uuid; v_rid uuid; v_target jsonb; v_note text;
  v_spec text[]; v_txt text; v_num numeric;
begin
  if p_owner is null then
    raise exception 'ai_program_invalid: owner';
  end if;
  if p_program is null or jsonb_typeof(p_program) <> 'object' then
    raise exception 'ai_program_invalid: not an object';
  end if;
  v_title := left(trim(coalesce(p_program->>'title', '')), 80);
  if v_title = '' then
    raise exception 'ai_program_invalid: title';
  end if;
  if coalesce(jsonb_typeof(p_program->'days'), '') <> 'array'
     or jsonb_array_length(p_program->'days') = 0 then
    raise exception 'ai_program_invalid: days';
  end if;
  v_level := case when p_program->>'level' in ('beginner','intermediate','advanced','elite')
                  then p_program->>'level' end;
  insert into programs (owner_id, title, description, weeks, level, is_public, ai_job_id)
  values (p_owner, v_title,
          trim(left(coalesce(p_program->>'description', ''), 500)
               || E'\n\n(AI 생성 — 최근 코칭 인사이트 기반)'),
          1, v_level, false, p_job_id)
  returning id into v_id;
  for d in
    select x.value from jsonb_array_elements(p_program->'days')
      with ordinality as x(value, ord) where x.ord <= 21
  loop
    if jsonb_typeof(d) <> 'object' then continue; end if;
    v_idx_txt := d->>'day_index';
    if v_idx_txt is null or v_idx_txt !~ '^\s*\d+(\.0+)?\s*$' then continue; end if;
    v_idx := floor(v_idx_txt::numeric)::int;
    if v_idx < 1 or v_idx > 7 then continue; end if;
    if v_idx = any(v_seen) then continue; end if;
    v_seen := v_seen || v_idx;
    insert into program_days (program_id, day_index, focus)
    values (v_id, v_idx, nullif(left(trim(coalesce(d->>'focus', '')), 60), ''))
    returning id into v_day_id;
    v_days := v_days + 1;
    v_items := case when jsonb_typeof(d->'items') = 'array' then d->'items'
                    else '[]'::jsonb end;
    if jsonb_array_length(v_items) = 0 then continue; end if;
    insert into workout_templates (program_day_id, title, type, structure)
    values (v_day_id,
            coalesce(nullif(left(trim(coalesce(d->>'title', '')), 80), ''),
                     nullif(left(trim(coalesce(d->>'focus', '')), 80), ''),
                     'Day ' || v_idx),
            'wod', '{}'::jsonb)
    returning id into v_tid;
    v_seq := 0;
    for it in
      select x.value from jsonb_array_elements(v_items)
        with ordinality as x(value, ord) where x.ord <= 10
    loop
      v_seq := v_seq + 1;
      if jsonb_typeof(it) <> 'object'
         or coalesce(jsonb_typeof(it->'exercise'), '') <> 'string' then
        raise exception 'ai_program_invalid: day % item % has no exercise', v_idx, v_seq;
      end if;
      v_name := trim(coalesce(it->>'exercise', ''));
      if v_name = '' then
        raise exception 'ai_program_invalid: day % item % has no exercise', v_idx, v_seq;
      end if;
      v_eid := resolve_exercise(v_name);
      v_rid := null;
      if v_eid is null then
        -- 미등록 운동 → 대기 항목 + 등록 요청(중복은 합쳐짐). 요청 실패는 생성을 막지 않는다.
        begin
          v_rid := ensure_exercise_request(p_owner, v_name,
                     'AI 프로그램 생성에서 자동 요청 — ' || v_title);
        exception when others then
          raise warning 'ai_materialize_program: exercise request skipped for "%": %', v_name, sqlerrm;
        end;
      end if;
      v_target := '{}'::jsonb;
      foreach v_spec slice 1 in array array[
        ['distance_m', '200000', 'int'],
        ['weight_kg',  '1000',   'dec'],
        ['reps',       '10000',  'int'],
        ['sets',       '100',    'int'],
        ['duration_s', '86400',  'int']
      ] loop
        v_txt := it->>v_spec[1];
        v_num := case when v_txt ~ '^\s*-?\d+(\.\d+)?\s*$' then v_txt::numeric end;
        if v_num is not null and v_num > 0 and v_num <= v_spec[2]::numeric then
          v_target := v_target || jsonb_build_object(
            v_spec[1],
            case when v_spec[3] = 'int' then to_jsonb(round(v_num)::int)
                 else to_jsonb(round(v_num, 2)) end);
        end if;
      end loop;
      v_note := left(nullif(trim(coalesce(it->>'note', '')), ''), 300);
      if v_note is not null then
        v_target := v_target || jsonb_build_object('note', v_note);
      end if;
      insert into workout_template_items
        (template_id, seq, exercise_id, target, exercise_request_id, pending_exercise)
      values (v_tid, v_seq, v_eid,
              case when v_target = '{}'::jsonb then null else v_target end,
              v_rid, case when v_eid is null then left(v_name, 60) end);
    end loop;
  end loop;
  if v_days = 0 then
    raise exception 'ai_program_invalid: no valid day';
  end if;
  return v_id;
end; $$;
revoke all on function public.ai_materialize_program(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.ai_materialize_program(uuid, jsonb, uuid) to service_role;

-- 8) 대기 항목 이름 반환 — program_calendar / mcp_program -------------------
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
                  'target', i.target,
                  'name_ko', coalesce(e.name_ko, i.pending_exercise),
                  'name_en', coalesce(e.name_en, i.pending_exercise),
                  'pending', e.id is null and i.pending_exercise is not null
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
    from programs p where p.id = p_id
  );
end; $$;
grant execute on function public.program_calendar(uuid, text) to anon, authenticated;

create or replace function public.mcp_program(p_token text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return (
    select jsonb_build_object(
      'id', p.id, 'title', p.title, 'description', p.description,
      'weeks', p.weeks, 'level', p.level, 'is_public', p.is_public,
      'week_pattern', p.week_pattern,
      'is_mine', p.owner_id = v_uid,
      'my_start_date', (select en.start_date from program_enrollments en
        where en.program_id = p.id and en.user_id = v_uid and en.active
        order by en.created_at desc limit 1),
      'pending_exercises', coalesce((
        select jsonb_agg(distinct i.pending_exercise)
        from workout_template_items i
        join workout_templates t on t.id = i.template_id
        join program_days d on d.id = t.program_day_id
        where d.program_id = p.id and i.exercise_id is null and i.pending_exercise is not null),
        '[]'::jsonb),
      'days', coalesce((select jsonb_agg(jsonb_build_object(
          'day_index', d.day_index, 'focus', d.focus, 'notes', d.notes,
          'rest', not exists (
            select 1 from workout_templates t where t.program_day_id = d.id),
          'workouts', coalesce((select jsonb_agg(jsonb_build_object(
              'title', t.title, 'type', t.type,
              'items', coalesce((select jsonb_agg(
                  jsonb_build_object('exercise', coalesce(e.name_ko, i.pending_exercise))
                    || case when e.id is null and i.pending_exercise is not null
                            then jsonb_build_object('pending_approval', true) else '{}'::jsonb end
                    || coalesce(i.target, '{}'::jsonb)
                  order by i.seq)
                from workout_template_items i
                left join exercises e on e.id = i.exercise_id
                where i.template_id = t.id), '[]'::jsonb))
              order by t.created_at)
            from workout_templates t where t.program_day_id = d.id), '[]'::jsonb))
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
grant execute on function public.mcp_program(text, uuid) to anon, authenticated;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_uid uuid; v_tok text; v_admin uuid; v_ex text; v_exid uuid;
  v_new text := 'zz가드신규운동' || substr(gen_random_uuid()::text, 1, 6);
  v_typo text;
  j jsonb; v_pid uuid; v_rid uuid; v_rid2 uuid; v_n int; v_item record; v_cal jsonb;
  v_claims text;
begin
  select id, mcp_token into v_uid, v_tok from public.profiles
   where not disabled and mcp_token is not null limit 1;
  select id into v_admin from public.profiles where is_admin and not disabled limit 1;
  select name_ko, id into v_ex, v_exid from public.exercises order by name_ko limit 1;
  if v_uid is null or v_admin is null or v_ex is null then
    raise notice '가드 건너뜀: 프로필/관리자/운동 표본 없음';
    return;
  end if;
  v_typo := v_ex || '즈';   -- 유사 후보가 잡히는 오타
  if jsonb_array_length(public.suggest_exercises(v_typo)) = 0 then
    raise notice '가드: 오타 표본(%)에 후보가 없어 confirm 분기 검증을 건너뜀', v_typo;
    v_typo := null;
  end if;
  update public.profiles set mcp_write = true where id = v_uid;

  -- (a) 후보 없는 미등록 이름 → 대기 항목 + 요청
  j := public.mcp_create_program(v_tok, '가드', 1, jsonb_build_array(jsonb_build_object(
         'day_index', 1, 'workouts', jsonb_build_array(jsonb_build_object('items', jsonb_build_array(
           jsonb_build_object('exercise', v_ex, 'reps', 10),
           jsonb_build_object('exercise', v_new, 'reps', 12, 'sets', 3)))))));
  if j->>'ok' is distinct from 'true' then raise exception '가드: 생성 실패 %', j; end if;
  if not (j->'pending_exercises' @> to_jsonb(array[v_new])) then
    raise exception '가드: pending_exercises 가 없다 %', j; end if;
  v_pid := (j->>'program_id')::uuid;
  select i.* into v_item from public.workout_template_items i
    join public.workout_templates t on t.id = i.template_id
    join public.program_days d on d.id = t.program_day_id
   where d.program_id = v_pid and i.seq = 2;
  if v_item.exercise_id is not null or v_item.pending_exercise <> v_new or v_item.exercise_request_id is null then
    raise exception '가드: 대기 항목이 기대와 다르다'; end if;
  v_rid := v_item.exercise_request_id;
  perform 1 from public.exercise_requests where id = v_rid and status = 'pending' and requested_by = v_uid;
  if not found then raise exception '가드: 요청 행이 없다'; end if;

  -- (b) 오타(후보 있음)는 confirm 없이는 거부, confirm 이면 대기 항목
  if v_typo is not null then
    j := public.mcp_set_program_day(v_tok, v_pid, 2, null, null, jsonb_build_array(jsonb_build_object(
           'items', jsonb_build_array(jsonb_build_object('exercise', v_typo)))));
    if j->>'error' is distinct from 'unknown_exercises' then
      raise exception '가드: 오타가 확인 없이 저장됐다 %', j; end if;
    j := public.mcp_set_program_day(v_tok, v_pid, 2, null, null, jsonb_build_array(jsonb_build_object(
           'items', jsonb_build_array(jsonb_build_object('exercise', v_typo)))), true);
    if j->>'ok' is distinct from 'true' or not (j->'pending_exercises' @> to_jsonb(array[v_typo])) then
      raise exception '가드: confirm_unknown 저장 실패 %', j; end if;
  end if;

  -- (c) 웹 빌더 경로: 같은 이름이면 같은 요청 id
  v_claims := json_build_object('sub', v_uid::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  v_rid2 := public.request_exercise_placeholder(' ' || v_new || ' ');
  if v_rid2 <> v_rid then raise exception '가드: 같은 이름인데 요청이 둘로 갈렸다'; end if;
  begin
    perform public.request_exercise_placeholder(v_ex);
    raise exception '가드: 등록된 운동에 placeholder 요청이 됐다';
  exception when others then
    if sqlerrm not like '%exercise_exists%' then raise; end if;
  end;

  -- (d) mcp_program / program_calendar 가 대기 이름을 돌려준다
  j := public.mcp_program(v_tok, v_pid);
  if not (j->'pending_exercises' @> to_jsonb(array[v_new])) then
    raise exception '가드: mcp_program pending_exercises 누락 %', j->'pending_exercises'; end if;
  v_cal := public.program_calendar(v_pid, (select calendar_token from public.programs where id = v_pid));
  if v_cal is null or v_cal::text not like '%' || v_new || '%' then
    raise exception '가드: program_calendar 에 대기 이름이 없다'; end if;

  -- (e) 비관리자는 승인 불가
  begin
    perform public.approve_exercise_request(v_rid);
    raise exception '가드: 비관리자가 승인했다';
  exception when others then
    if sqlerrm not like '%admin_only%' then raise; end if;
  end;

  -- (f) 관리자 승인(새 운동) → 항목 자동 채움
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.approve_exercise_request(v_rid, null, 'guard new');
  if j->>'ok' is distinct from 'true' or (j->>'items_filled')::int < 1 then
    raise exception '가드: 승인 결과 이상 %', j; end if;
  select i.* into v_item from public.workout_template_items i where i.id = v_item.id;
  if v_item.exercise_id is null or v_item.pending_exercise is not null then
    raise exception '가드: 승인 뒤 항목이 채워지지 않았다'; end if;
  perform 1 from public.exercise_requests where id = v_rid and status = 'approved' and resolved_exercise_id = v_item.exercise_id;
  if not found then raise exception '가드: 요청의 resolved_exercise_id 가 다르다'; end if;
  if public.resolve_exercise(v_new) is distinct from v_item.exercise_id then
    raise exception '가드: 새 운동이 이름으로 해석되지 않는다'; end if;

  -- (g) 기존 운동에 연결 승인 → 별칭 추가 + 항목 채움 ; (h) 거절은 항목 유지
  if v_typo is not null then
    select i.exercise_request_id into v_rid2 from public.workout_template_items i
      join public.workout_templates t on t.id = i.template_id
      join public.program_days d on d.id = t.program_day_id
     where d.program_id = v_pid and d.day_index = 2 limit 1;
    j := public.approve_exercise_request(v_rid2, v_exid);
    if j->>'ok' is distinct from 'true' then raise exception '가드: 연결 승인 실패 %', j; end if;
    if public.resolve_exercise(v_typo) is distinct from v_exid then
      raise exception '가드: 별칭이 추가되지 않았다'; end if;
    select count(*) into v_n from public.workout_template_items i
      join public.workout_templates t on t.id = i.template_id
      join public.program_days d on d.id = t.program_day_id
     where d.program_id = v_pid and d.day_index = 2 and i.exercise_id = v_exid;
    if v_n < 1 then raise exception '가드: 연결 승인 뒤 항목이 안 채워졌다'; end if;
  end if;
  v_rid2 := public.ensure_exercise_request(v_uid, v_new || '2', 'guard');
  insert into public.workout_template_items (template_id, seq, exercise_request_id, pending_exercise)
  select t.id, 9, v_rid2, v_new || '2' from public.workout_templates t
    join public.program_days d on d.id = t.program_day_id where d.program_id = v_pid limit 1;
  j := public.reject_exercise_request(v_rid2);
  if j->>'ok' is distinct from 'true' then raise exception '가드: 거절 실패 %', j; end if;
  perform 1 from public.workout_template_items where exercise_request_id = v_rid2
     and exercise_id is null and pending_exercise = v_new || '2';
  if not found then raise exception '가드: 거절 뒤 항목이 사라지거나 바뀌었다'; end if;

  -- (i) AI 실체화도 요청 id·이름을 기록하고 note 에는 이름을 넣지 않는다
  perform set_config('request.jwt.claims', '', true);
  v_pid := public.ai_materialize_program(v_uid, jsonb_build_object('title', 'ai가드', 'days',
    jsonb_build_array(jsonb_build_object('day_index', 1, 'items', jsonb_build_array(
      jsonb_build_object('exercise', v_new || '3', 'reps', 5, 'note', '천천히'))))), gen_random_uuid());
  select i.* into v_item from public.workout_template_items i
    join public.workout_templates t on t.id = i.template_id
    join public.program_days d on d.id = t.program_day_id where d.program_id = v_pid limit 1;
  if v_item.exercise_request_id is null or v_item.pending_exercise <> v_new || '3'
     or v_item.target->>'note' <> '천천히' then
    raise exception '가드: AI 대기 항목이 기대와 다르다 %', to_jsonb(v_item); end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
