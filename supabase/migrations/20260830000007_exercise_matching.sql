-- ============================================================
-- Roxlogy — 운동 매칭 고도화 (표기 차이 vs 실제 미등록 구분)
--
-- case 2(같은 운동, 다른 표기) 처리:
--   · 정규화 비교(소문자·공백 제거): "버피 브로드 점프" = "버피브로드점프"
--   · exercises.aliases 별칭 배열 — "스키", "SkiErg" 등 (어드민 편집)
--   · 매칭 실패 시 유사 후보(suggestions) 반환 → AI 가 사용자에게
--     "'월 볼' → '월볼' 맞나요?" 확인 후 올바른 이름으로 재시도
-- case 1(실제 미등록) 처리:
--   · request_exercise 가 유사 운동을 먼저 보여주고, 진짜 새 운동임을
--     confirm_new=true 로 확인했을 때만 등록 요청 생성 (중복 등록 방지)
-- ============================================================

create extension if not exists pg_trgm;

alter table public.exercises
  add column if not exists aliases text[] not null default '{}';

-- 정규화: 소문자 + 공백 제거
create or replace function public.norm_exname(p text)
returns text
language sql immutable as $$
  select lower(regexp_replace(coalesce(p, ''), '\s', '', 'g'));
$$;

-- 이름 → 운동 id (name_ko / name_en / aliases, 정규화 비교)
create or replace function public.resolve_exercise(p_name text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select id from exercises e
  where norm_exname(e.name_ko) = norm_exname(p_name)
     or norm_exname(e.name_en) = norm_exname(p_name)
     or exists (select 1 from unnest(e.aliases) a
                where norm_exname(a) = norm_exname(p_name))
  limit 1;
$$;

-- 유사 후보 상위 3 — 부분 포함(강한 신호) + trigram 유사도
create or replace function public.suggest_exercises(p_name text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select case when length(norm_exname(p_name)) < 2 then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object(
      'name_ko', s.name_ko, 'name_en', s.name_en) order by s.score desc)
    from (
      select t.name_ko, t.name_en, t.score
      from (
        select e.name_ko, e.name_en,
          greatest(
            similarity(norm_exname(e.name_ko), norm_exname(p_name)),
            similarity(norm_exname(e.name_en), norm_exname(p_name)),
            coalesce((select max(similarity(norm_exname(a), norm_exname(p_name)))
                      from unnest(e.aliases) a), 0),
            case when norm_exname(e.name_ko) like '%' || norm_exname(p_name) || '%'
                   or norm_exname(p_name) like '%' || norm_exname(e.name_ko) || '%'
                   or norm_exname(e.name_en) like '%' || norm_exname(p_name) || '%'
                   or norm_exname(p_name) like '%' || norm_exname(e.name_en) || '%'
                 then 0.9 else 0 end
          ) as score
        from exercises e
      ) t
      where t.score >= 0.3
      order by t.score desc
      limit 3
    ) s), '[]'::jsonb)
  end;
$$;

-- 운동 DB 목록에 별칭 포함
create or replace function public.mcp_exercises(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if mcp_uid(p_token) is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'name_ko', e.name_ko, 'name_en', e.name_en,
      'aliases', to_jsonb(e.aliases),
      'station_type', e.station_type, 'category', e.category)
      order by e.station_type nulls last, e.name_ko)
    from exercises e), '[]'::jsonb);
end; $$;

-- 워크아웃 검증: 미등록 이름마다 유사 후보를 함께 반환
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
      insert into workout_template_items (template_id, seq, exercise_id, target)
      values (v_tid, v_seq, v_eid,
              case when nullif(trim(coalesce(it->>'note', '')), '') is not null
                   then jsonb_build_object('note', left(trim(it->>'note'), 80))
                   else null end);
    end loop;
  end loop;
  return null;
end; $$;

-- 등록 요청: 유사 운동이 있으면 먼저 보여주고, confirm_new 로만 강행
drop function if exists public.mcp_request_exercise(text, text, text, text);
create function public.mcp_request_exercise(
  p_token text, p_name_ko text, p_name_en text default null,
  p_note text default null, p_confirm_new boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_exist uuid;
  v_id uuid;
  v_sugs jsonb;
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

  -- case 2 가드: 표기만 다른 같은 운동일 수 있으면 요청 대신 후보 반환
  if not coalesce(p_confirm_new, false) then
    v_sugs := suggest_exercises(p_name_ko);
    if p_name_en is not null and jsonb_array_length(v_sugs) = 0 then
      v_sugs := suggest_exercises(p_name_en);
    end if;
    if jsonb_array_length(v_sugs) > 0 then
      return jsonb_build_object('similar_existing', v_sugs,
        'hint', '같은 운동이면 사용자 확인 후 그 등록 이름을 그대로 쓰세요. 정말 다른 새 운동이면 confirm_new=true 로 다시 요청하세요.');
    end if;
  end if;

  if exists (select 1 from exercise_requests r
    where r.status = 'pending'
      and norm_exname(r.name_ko) = norm_exname(p_name_ko)) then
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

grant execute on function
  public.mcp_request_exercise(text, text, text, text, boolean)
to anon, authenticated;
