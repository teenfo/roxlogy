-- ============================================================
-- Roxlogy — AI 생성 프로그램의 미등록 운동을 등록 요청(exercise_requests)으로 남긴다
--
-- 배경
--   ai_materialize_program()(088)은 운동 DB 에 없는 이름을 만나면 exercise_id 없이
--   이름만 target.note 에 남기고 지나갔다. 사람이 고칠 기회가 없는 경로라 막지 않은
--   것인데, 그 결과 미등록 운동이 관리자에게 보이지 않아 영영 등록되지 않았다.
--   MCP(mcp_request_exercise)·웹 빌더는 같은 상황에서 exercise_requests 에 요청을 남긴다.
--
-- 변경
--   같은 함수가 미등록 이름을 만나면 exercise_requests 에 pending 요청을 자동으로 넣는다.
--   · requested_by = 프로그램 소유자(p_owner). 관리자 화면(어드민 > 콘텐츠)에 요청자로 보인다.
--   · note 에 어느 프로그램에서 나왔는지 남긴다.
--   · 중복 방지: mcp_request_exercise 와 같은 기준(pending 요청 중 norm_exname 일치)이면
--     넣지 않는다. 같은 프로그램 안에서 같은 이름이 여러 번 나와도 한 번만.
--   · 요청 삽입 실패는 프로그램 생성을 막지 않는다(부수 효과) — 예외를 삼키고 경고만.
--   실체화 결과·반환값은 그대로다.
--
-- 되돌리기: 088 의 ai_materialize_program 정의를 다시 적용.
-- ============================================================

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
  v_name text; v_eid uuid; v_target jsonb; v_note text;
  v_spec text[]; v_txt text; v_num numeric;
  v_requested text[] := '{}';   -- 이번 호출에서 이미 요청을 남긴 이름(정규화)
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

      -- 미등록 운동 → 등록 요청 자동 생성 (관리자 승인 대기). 실패해도 프로그램은 만든다.
      if v_eid is null and not (norm_exname(v_name) = any(v_requested)) then
        v_requested := v_requested || norm_exname(v_name);
        begin
          if not exists (select 1 from exercise_requests r
                          where r.status = 'pending'
                            and norm_exname(r.name_ko) = norm_exname(v_name)) then
            insert into exercise_requests (requested_by, name_ko, note)
            values (p_owner, left(v_name, 60),
                    left('AI 프로그램 생성에서 자동 요청 — ' || v_title, 300));
          end if;
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
      v_note := left(concat_ws(' — ',
                  case when v_eid is null then v_name end,
                  nullif(trim(coalesce(it->>'note', '')), '')), 300);
      if v_note <> '' then
        v_target := v_target || jsonb_build_object('note', v_note);
      end if;
      insert into workout_template_items (template_id, seq, exercise_id, target)
      values (v_tid, v_seq, v_eid,
              case when v_target = '{}'::jsonb then null else v_target end);
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
comment on function public.ai_materialize_program(uuid, jsonb, uuid) is
  'AI 프로그램 JSON → programs/일차/워크아웃/아이템을 한 트랜잭션에 실체화. 실패 시 ai_program_invalid 예외로 전체 롤백. '
  '미등록 운동은 exercise_requests 에 pending 요청을 자동으로 남긴다(중복은 건너뜀). Edge 전용.';

-- 가드 --------------------------------------------------------------------
do $$
declare
  v_uid uuid; v_ex text; v_pid uuid; v_n int;
  v_unknown text := 'zz가드미등록운동' || substr(gen_random_uuid()::text, 1, 8);
  v_plan jsonb;
begin
  select id into v_uid from public.profiles limit 1;
  select name_ko into v_ex from public.exercises order by name_ko limit 1;
  if v_uid is null or v_ex is null then
    raise notice '가드 건너뜀: profiles 또는 exercises 가 비어 있음';
    return;
  end if;
  v_plan := jsonb_build_object('title', '가드', 'days', jsonb_build_array(
    jsonb_build_object('day_index', 1, 'items', jsonb_build_array(
      jsonb_build_object('exercise', v_ex, 'reps', 10),
      jsonb_build_object('exercise', v_unknown, 'reps', 12),
      jsonb_build_object('exercise', ' ' || v_unknown || ' ', 'sets', 3)))));   -- 같은 이름 두 번

  v_pid := public.ai_materialize_program(v_uid, v_plan, gen_random_uuid());
  select count(*) into v_n from public.exercise_requests
   where status = 'pending' and norm_exname(name_ko) = norm_exname(v_unknown);
  if v_n <> 1 then
    raise exception '가드: 미등록 운동 요청이 %건 (1건 기대)', v_n;
  end if;
  perform 1 from public.exercise_requests
   where norm_exname(name_ko) = norm_exname(v_unknown)
     and requested_by = v_uid and note like 'AI 프로그램 생성에서 자동 요청%';
  if not found then raise exception '가드: 요청자·메모가 기대와 다릅니다'; end if;
  -- 등록된 운동은 요청되지 않는다
  if exists (select 1 from public.exercise_requests
              where status = 'pending' and norm_exname(name_ko) = norm_exname(v_ex)
                and note like 'AI 프로그램 생성에서 자동 요청%') then
    raise exception '가드: 등록된 운동에 요청이 생겼습니다';
  end if;
  -- 두 번째 프로그램: 이미 pending 이면 중복 요청 없음
  perform public.ai_materialize_program(v_uid, v_plan, gen_random_uuid());
  select count(*) into v_n from public.exercise_requests
   where status = 'pending' and norm_exname(name_ko) = norm_exname(v_unknown);
  if v_n <> 1 then
    raise exception '가드: 중복 요청이 생겼습니다 (%건)', v_n;
  end if;
  -- 아이템은 여전히 이름을 note 에 남긴 채 exercise_id 없이 저장된다
  perform 1 from public.workout_template_items i
    join public.workout_templates t on t.id = i.template_id
    join public.program_days dd on dd.id = t.program_day_id
   where dd.program_id = v_pid and i.seq = 2 and i.exercise_id is null
     and i.target->>'note' = v_unknown;
  if not found then raise exception '가드: 미등록 아이템의 note 가 기대와 다릅니다'; end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
