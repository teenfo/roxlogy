-- ============================================================
-- Roxlogy — 워크아웃 아이템 target 구조화 (통계 가능한 숫자 필드)
--
-- note 자유 텍스트 하나에 섞여 있던 처방을 숫자 필드로 분리한다:
--   distance_m(정수 m) · weight_kg(숫자) · reps(정수) · sets(정수)
--   · duration_s(정수 초) · note(나머지 자유 기입)
-- 표시 문자열은 클라이언트가 숫자에서 조립(web/lib/target.ts)하고,
-- 주간 계획 볼륨·계획 대비 수행 통계는 숫자 필드로 집계한다.
-- 기존 아이템의 note 는 정규식으로 파싱해 이전한다 (검증 가드 포함).
-- MCP: _mcp_insert_workouts 가 구조화 필드를 받고(범위 검증),
--       mcp_program 이 일차별 workouts·items 를 구조화해 반환한다.
-- ============================================================

-- ---------- 1) 기존 아이템 note → 구조화 필드 파싱
do $$
declare
  r record;
  v_n text;
  v_sets int;
  v_reps int;
  v_dist int;
  v_weight numeric;
  v_note text;
  v_target jsonb;
begin
  for r in select i.id, i.target->>'note' as n
    from workout_template_items i
    where i.target ? 'note' and nullif(trim(i.target->>'note'), '') is not null
  loop
    v_n := r.n;
    v_sets := (regexp_match(v_n, '(\d+)\s*세트'))[1]::int;
    -- 거리: km 우선, 없으면 단독 m (뒤에 알파벳/한글이 붙는 m 은 제외)
    v_dist := (
      select round(x[1]::numeric * 1000)::int
      from regexp_match(v_n, '(\d+\.?\d*)\s*km') x)::int;
    if v_dist is null then
      v_dist := (regexp_match(v_n, '(\d+\.?\d*)\s*m([^a-zA-Z가-힣]|$)'))[1]::numeric::int;
    end if;
    v_weight := (regexp_match(v_n, '(\d+\.?\d*)\s*kg'))[1]::numeric;
    -- 횟수: 세트당 처방(× N회) 우선, 세트 표기가 없을 때만 단독 N회
    v_reps := (regexp_match(v_n, '×\s*(\d+)\s*회'))[1]::int;
    if v_reps is null and v_sets is null then
      v_reps := (regexp_match(v_n, '(\d+)\s*회'))[1]::int;
    end if;

    -- 나머지 텍스트 = note (추출된 처방 표기·구분자 제거)
    v_note := v_n;
    v_note := regexp_replace(v_note, '^\s*\d+\s*회\s*·\s*', '');
    v_note := regexp_replace(v_note, '\d+\s*세트\s*×\s*\d+\.?\d*\s*(km|m|회|kg)', '', 'g');
    v_note := regexp_replace(v_note, '\d+\.?\d*\s*(km|m|kg|회)\s*×\s*\d+\s*세트', '', 'g');
    v_note := regexp_replace(v_note, '^\s*\d+\.?\d*\s*(km|kg)\s*', '');
    v_note := regexp_replace(v_note, '^\s*\d+\.?\d*\s*m\s+', '');
    v_note := regexp_replace(v_note, '\s*,\s*', ' · ', 'g');
    v_note := regexp_replace(v_note, '(\s*·\s*)+', ' · ', 'g');
    v_note := btrim(v_note, ' ·,');

    v_target := jsonb_strip_nulls(jsonb_build_object(
      'distance_m', v_dist, 'weight_kg', v_weight,
      'reps', v_reps, 'sets', v_sets,
      'note', nullif(v_note, '')));
    update workout_template_items
    set target = case when v_target = '{}'::jsonb then null else v_target end
    where id = r.id;
  end loop;
end $$;

-- 가드: 처방 표기가 note 에 남아 있으면 실패
do $$
begin
  if exists (select 1 from workout_template_items i
             where i.target->>'note' ~ '(세트\s*×|×\s*\d+\s*(회|세트)|\d+\s*(km|kg))') then
    raise exception 'unparsed prescription remains in item notes';
  end if;
end $$;

-- ---------- 2) _mcp_insert_workouts: 구조화 필드 수용 + 범위 검증
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
  v_sugs jsonb := '{}'::jsonb;
  v_name text;
  v_target jsonb;
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
      if resolve_exercise(v_name) is null
         and not (v_name = any(v_unknown)) then
        v_unknown := v_unknown || v_name;
        v_sugs := v_sugs || jsonb_build_object(v_name, suggest_exercises(v_name));
      end if;
      -- 구조화 필드 범위 검증 (형 오류는 예외 → 롤백)
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
    end loop;
  end loop;
  if array_length(v_unknown, 1) > 0 then
    return jsonb_build_object('error', 'unknown_exercises',
      'unknown', to_jsonb(v_unknown),
      'suggestions', v_sugs,
      'hint', 'suggestions 의 후보가 같은 운동이면 사용자에게 확인 후 그 이름으로 재시도하고, 실제로 없는 운동이면 request_exercise 로 등록을 요청하세요.');
  end if;

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
      v_target := jsonb_strip_nulls(jsonb_build_object(
        'distance_m', round((it->>'distance_m')::numeric)::int,
        'weight_kg', (it->>'weight_kg')::numeric,
        'reps', round((it->>'reps')::numeric)::int,
        'sets', round((it->>'sets')::numeric)::int,
        'duration_s', round((it->>'duration_s')::numeric)::int,
        'note', nullif(left(trim(coalesce(it->>'note', '')), 80), '')));
      insert into workout_template_items (template_id, seq, exercise_id, target)
      values (v_tid, v_seq, v_eid,
              case when v_target = '{}'::jsonb then null else v_target end);
    end loop;
  end loop;
  return null;
end; $$;

-- ---------- 3) mcp_program: 일차별 workouts·items 구조화 반환
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
          'day_index', d.day_index, 'focus', d.focus, 'notes', d.notes,
          'workouts', coalesce((select jsonb_agg(jsonb_build_object(
              'title', t.title, 'type', t.type,
              'items', coalesce((select jsonb_agg(
                  jsonb_build_object('exercise', e.name_ko)
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
