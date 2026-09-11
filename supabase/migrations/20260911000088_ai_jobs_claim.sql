-- ============================================================
-- Roxlogy — AI 저장 원자화·오류 검사 + 작업 클레임 (감사 2026-09-11 A06·A07)
--
-- 문제
--   A06: Edge analysis-dispatch 가 programs INSERT 뒤 program_days /
--        workout_templates / workout_template_items INSERT 실패를 건너뛰고
--        프로그램 id 를 돌려줬다(빈 프로그램 + "도착" 알림). 인사이트 교체도
--        DELETE 와 INSERT 를 따로 보내 사이에서 실패하면 기존 인사이트만 사라졌다.
--   A07: 완료된 AI 작업 수령(ai_jobs SELECT → 생성 → 알림 → 삭제)에 클레임이
--        없어 크론 두 실행이 겹치면 같은 작업으로 프로그램·알림이 중복됐다.
--        프로그램 요청 제출도 job_id is null 을 조회한 뒤 외부 제출이라 같은 문제.
--
-- 해결
--   1) ai_materialize_program(): programs + days + templates + items 를 한 함수
--      호출(= 한 트랜잭션)에 넣는다. 하나라도 실패하면 예외 → 전체 롤백.
--      programs.ai_job_id(부분 유니크)로 같은 작업의 두 번째 실체화를 DB 가 막는다.
--   2) ai_replace_insights(): 인사이트 delete+insert 와 ai_status='done' 을
--      한 트랜잭션에.
--   3) ai_jobs.claimed_at / claim_count / submit_claimed_at + ai_jobs_claim() /
--      ai_jobs_submit_claim(): 조건부 UPDATE … RETURNING 한 문장으로 원자적 임대.
--      임대는 10분 — 처리기가 중간에 죽으면 만료 뒤 다른 실행이 이어받는다.
--      claim_count 는 같은 작업이 몇 번 잡혔는지 — Edge 가 상한(5)을 넘으면
--      포기해서 영구 실패 작업이 10분마다 무한 재시도되지 않게 한다.
--   전부 내부용(SECURITY DEFINER, Edge 가 service role 로 rpc). 호출자 검증이
--   없으므로 anon/authenticated 에는 grant 하지 않는다.
--   컬럼은 덧붙이기만 — 옛 Edge 번들은 새 컬럼을 무시하므로 배포 순서 무관.
--
-- 되돌리기
--   drop function public.ai_materialize_program(uuid, jsonb, uuid);
--   drop function public.ai_replace_insights(uuid, text, uuid, date, text, text);
--   drop function public.ai_jobs_claim(uuid);
--   drop function public.ai_jobs_submit_claim(uuid);
--   drop index public.programs_ai_job_uq;
--   alter table public.programs drop column ai_job_id;
--   alter table public.ai_jobs drop column claimed_at, drop column claim_count,
--     drop column submit_claimed_at;
-- ============================================================

-- ---------- 1) 컬럼 덧붙이기 -----------------------------------------------
alter table public.ai_jobs
  add column if not exists claimed_at        timestamptz,
  add column if not exists claim_count       int not null default 0,
  add column if not exists submit_claimed_at timestamptz;

comment on column public.ai_jobs.claimed_at is
  '완료 결과 수령 임대 시각. ai_jobs_claim() 이 잡고, 10분 지나면 다른 실행이 다시 잡는다.';
comment on column public.ai_jobs.claim_count is
  '수령 임대가 잡힌 횟수. Edge 가 상한을 넘기면 포기(실패 처리)한다.';
comment on column public.ai_jobs.submit_claimed_at is
  '프로그램 요청 제출 임대 시각(job_id 가 아직 없는 행). 10분 지나면 다시 잡힌다.';

alter table public.programs
  add column if not exists ai_job_id uuid;
create unique index if not exists programs_ai_job_uq
  on public.programs(ai_job_id) where ai_job_id is not null;
comment on column public.programs.ai_job_id is
  'AI 생성 프로그램의 원본 ai_jobs.id. 유니크라 같은 작업이 두 번 실체화되지 않는다 (작업 행은 완료 후 삭제되므로 FK 없음).';

-- ---------- 2) 수령 클레임 ---------------------------------------------------
-- 조건부 UPDATE 한 문장이라 두 실행이 동시에 불러도 한쪽만 행을 돌려받는다
-- (같은 행 UPDATE 는 직렬화되고, 늦은 쪽은 재평가한 WHERE 에서 탈락).
-- 처리기가 중간에 죽으면 claimed_at 만 남는다 → 10분 뒤 WHERE 가 다시 참이 되어
-- 다른 실행이 이어받는다. 프로그램 중복은 programs.ai_job_id 유니크가 막는다.
create or replace function public.ai_jobs_claim(p_id uuid)
returns setof public.ai_jobs
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
    update ai_jobs
       set claimed_at = now(), claim_count = claim_count + 1
     where id = p_id
       and job_id is not null
       and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    returning *;
end; $$;
revoke all on function public.ai_jobs_claim(uuid) from public, anon, authenticated;
grant execute on function public.ai_jobs_claim(uuid) to service_role;
comment on function public.ai_jobs_claim(uuid) is
  '완료된 AI 작업 수령 임대(10분). 잡으면 행을 돌려주고, 이미 임대 중이면 0행. Edge 전용.';

-- ---------- 3) 제출 클레임 ---------------------------------------------------
-- 프로그램 요청(job_id is null)을 게이트웨이에 보내기 전에 잡는다. 제출 중 죽으면
-- 10분 뒤 다른 실행이 재제출한다(게이트웨이 잡 하나가 고아가 될 수는 있지만
-- job_id 는 하나만 기록되므로 프로그램은 하나만 만들어진다).
create or replace function public.ai_jobs_submit_claim(p_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update ai_jobs
     set submit_claimed_at = now()
   where id = p_id
     and job_id is null
     and (submit_claimed_at is null or submit_claimed_at < now() - interval '10 minutes');
  get diagnostics v_n = row_count;
  return v_n = 1;
end; $$;
revoke all on function public.ai_jobs_submit_claim(uuid) from public, anon, authenticated;
grant execute on function public.ai_jobs_submit_claim(uuid) to service_role;
comment on function public.ai_jobs_submit_claim(uuid) is
  '프로그램 요청 제출 임대(10분). 잡으면 true, 이미 임대 중이거나 제출됐으면 false. Edge 전용.';

-- ---------- 4) 프로그램 실체화 (한 트랜잭션) ----------------------------------
-- p_program 은 32b 가 출력한 프로그램 JSON(Edge 가 코드펜스만 벗겨 넘김):
--   {title, description, level, days:[{day_index, focus, title,
--     items:[{exercise, distance_m, weight_kg, reps, sets, duration_s, note}]}]}
-- 관용 규칙은 옛 Edge 구현을 그대로 옮겼다 — 범위 밖 day_index 는 건너뛰고,
-- 운동 이름이 DB 와 안 맞으면 exercise_id null 로 두고 이름을 note 앞에 남긴다
-- (모델이 표기를 살짝 바꿔도 프로그램 전체를 버리지 않기 위해).
-- 반대로 항목에 exercise 가 아예 없거나(빈 문자열·비문자열) 유효한 일차가 하나도
-- 없으면 ai_program_invalid 예외 — 빈 프로그램을 만들지 않는다. 예외가 나면
-- 이미 넣은 programs/program_days 행까지 이 문장 전체가 롤백된다.
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
  -- 키가 없으면 jsonb_typeof 가 NULL 이라 <> 비교도 NULL(=거짓)이 된다 — coalesce 필수
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

  -- 일차: 모델 출력 순서대로, 최대 21개 항목만 본다(7일 프로그램 + 여유)
  for d in
    select x.value from jsonb_array_elements(p_program->'days')
      with ordinality as x(value, ord) where x.ord <= 21
  loop
    if jsonb_typeof(d) <> 'object' then continue; end if;
    v_idx_txt := d->>'day_index';
    if v_idx_txt is null or v_idx_txt !~ '^\s*\d+(\.0+)?\s*$' then continue; end if;
    v_idx := floor(v_idx_txt::numeric)::int;
    if v_idx < 1 or v_idx > 7 then continue; end if;      -- 범위 밖 → 건너뜀
    if v_idx = any(v_seen) then continue; end if;          -- 같은 일차 두 번 → 첫 것만
    v_seen := v_seen || v_idx;

    insert into program_days (program_id, day_index, focus)
    values (v_id, v_idx, nullif(left(trim(coalesce(d->>'focus', '')), 60), ''))
    returning id into v_day_id;
    v_days := v_days + 1;

    v_items := case when jsonb_typeof(d->'items') = 'array' then d->'items'
                    else '[]'::jsonb end;
    if jsonb_array_length(v_items) = 0 then continue; end if; -- 휴식일

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
      -- exercise 키가 없으면 jsonb_typeof 가 NULL → coalesce 없이는 검사를 통과한다
      if jsonb_typeof(it) <> 'object'
         or coalesce(jsonb_typeof(it->'exercise'), '') <> 'string' then
        raise exception 'ai_program_invalid: day % item % has no exercise', v_idx, v_seq;
      end if;
      v_name := trim(coalesce(it->>'exercise', ''));
      if v_name = '' then
        raise exception 'ai_program_invalid: day % item % has no exercise', v_idx, v_seq;
      end if;
      v_eid := resolve_exercise(v_name);

      -- 처방은 구조화 필드로 저장한다 (20260830000011 계약) — note 문장으로 넣으면
      -- 주간 볼륨·계획 대비 수행 통계에서 이 프로그램만 빠진다.
      -- 범위 밖·숫자 아님은 그 필드만 버린다(옛 Edge 와 동일).
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
      -- 매칭 실패한 운동 이름은 잃지 않도록 note 앞에 남긴다
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
  'AI 프로그램 JSON → programs/일차/워크아웃/아이템을 한 트랜잭션에 실체화. 실패 시 ai_program_invalid 예외로 전체 롤백. Edge 전용.';

-- ---------- 5) 인사이트 교체 (한 트랜잭션) ------------------------------------
-- 부분 유니크(ref_id / period_start)라 upsert 를 못 쓰고 delete+insert 로 갈아
-- 끼운다. 옛 Edge 는 두 문장을 따로 보내 INSERT 가 실패하면 기존 인사이트만
-- 사라졌다. 여기서는 예외가 나면 DELETE 도 함께 롤백된다.
-- 세션/레이스의 ai_status='done' 도 같은 트랜잭션에 — 인사이트 없이 done 이
-- 되거나 그 반대가 생기지 않는다.
create or replace function public.ai_replace_insights(
  p_user uuid, p_kind text, p_ref_id uuid, p_period_start date,
  p_content text, p_model text
)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_content text := trim(coalesce(p_content, ''));
begin
  if p_user is null or p_kind is null then
    raise exception 'ai_insight_invalid: user/kind';
  end if;
  if v_content = '' then
    raise exception 'ai_insight_invalid: empty content';
  end if;
  -- 둘 다 없으면 그 종류의 인사이트 전부가 지워진다 — Edge 는 이런 호출을 하지
  -- 않지만, 실수로라도 통째로 지우지 못하게 막는다.
  if p_ref_id is null and p_period_start is null then
    raise exception 'ai_insight_invalid: ref_id or period_start required';
  end if;

  delete from ai_insights
   where user_id = p_user and kind = p_kind
     and (p_ref_id is null or ref_id = p_ref_id)
     and (p_period_start is null or period_start = p_period_start);

  insert into ai_insights (user_id, kind, ref_id, period_start, content, model)
  values (p_user, p_kind, p_ref_id, p_period_start, v_content, p_model)
  returning id into v_id;

  if p_kind = 'session' then
    update sessions set ai_status = 'done' where id = p_ref_id;
  elsif p_kind = 'race' then
    update race_results set ai_status = 'done' where id = p_ref_id;
  end if;
  return v_id;
end; $$;
revoke all on function public.ai_replace_insights(uuid, text, uuid, date, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_replace_insights(uuid, text, uuid, date, text, text)
  to service_role;
comment on function public.ai_replace_insights(uuid, text, uuid, date, text, text) is
  'AI 인사이트 delete+insert 와 ai_status=done 을 한 트랜잭션에. 실패 시 ai_insight_invalid 예외. Edge 전용.';

-- ---------- 가드 -------------------------------------------------------------
-- 실제 프로필·운동 행으로 검증하므로 끝에 반드시 되돌린다(__guard_rollback__).
-- 프로필/운동이 없는 빈 DB(로컬)에서는 검증 없이 통과한다.
do $$
declare
  v_uid uuid; v_ex text;
  v_job uuid := gen_random_uuid(); v_job2 uuid := gen_random_uuid();
  v_pid uuid; v_plan jsonb; v_n int;
  v_ref uuid := gen_random_uuid(); v_ins uuid; v_ins2 uuid; v_sess uuid;
  v_jid uuid; v_row public.ai_jobs; v_ok boolean;
  v_fn text;
begin
  select id into v_uid from public.profiles limit 1;
  select name_ko into v_ex from public.exercises order by name_ko limit 1;
  if v_uid is null or v_ex is null then
    raise notice '가드 건너뜀: profiles 또는 exercises 가 비어 있음';
    return;
  end if;
  if public.resolve_exercise(v_ex) is null then
    raise exception '가드: 표본 운동 % 이 resolve_exercise 로 해석되지 않습니다', v_ex;
  end if;

  -- (a) 정상 실체화: 일차 3(1·2·3), 워크아웃 2(2일차는 휴식), 아이템 3.
  --     day_index 9 는 범위 밖, 두 번째 day_index 1 은 중복 → 둘 다 건너뜀.
  v_plan := jsonb_build_object(
    'title', '  가드 프로그램  ', 'description', '설명', 'level', 'intermediate',
    'days', jsonb_build_array(
      jsonb_build_object('day_index', 1, 'focus', '런', 'title', '1일차',
        'items', jsonb_build_array(
          jsonb_build_object('exercise', v_ex, 'distance_m', 400, 'sets', 8, 'note', '세트간 90초'),
          jsonb_build_object('exercise', 'zz존재하지않는운동qq', 'reps', 12, 'sets', 3))),
      jsonb_build_object('day_index', 2, 'focus', '휴식', 'items', jsonb_build_array()),
      jsonb_build_object('day_index', 3, 'focus', '스테이션',
        'items', jsonb_build_array(
          jsonb_build_object('exercise', v_ex, 'duration_s', 60, 'weight_kg', 24.5, 'reps', -3))),
      jsonb_build_object('day_index', 9, 'items', jsonb_build_array(jsonb_build_object('exercise', v_ex))),
      jsonb_build_object('day_index', 1, 'items', jsonb_build_array(jsonb_build_object('exercise', v_ex)))
    ));
  v_pid := public.ai_materialize_program(v_uid, v_plan, v_job);
  perform 1 from public.programs
   where id = v_pid and owner_id = v_uid and ai_job_id = v_job
     and title = '가드 프로그램' and level = 'intermediate' and weeks = 1 and is_public = false
     and description like '설명%(AI 생성%';
  if not found then raise exception '가드: programs 행이 기대와 다릅니다'; end if;
  select count(*) into v_n from public.program_days where program_id = v_pid;
  if v_n <> 3 then raise exception '가드: 일차 3개를 기대했는데 %개', v_n; end if;
  select count(*) into v_n from public.workout_templates t
    join public.program_days d on d.id = t.program_day_id where d.program_id = v_pid;
  if v_n <> 2 then raise exception '가드: 워크아웃 2개를 기대했는데 %개', v_n; end if;
  select count(*) into v_n from public.workout_template_items i
    join public.workout_templates t on t.id = i.template_id
    join public.program_days d on d.id = t.program_day_id where d.program_id = v_pid;
  if v_n <> 3 then raise exception '가드: 아이템 3개를 기대했는데 %개', v_n; end if;
  -- 매칭된 운동: exercise_id 채워지고 숫자 필드는 구조화, note 는 그대로
  perform 1 from public.workout_template_items i
    join public.workout_templates t on t.id = i.template_id
    join public.program_days d on d.id = t.program_day_id
   where d.program_id = v_pid and d.day_index = 1 and i.seq = 1
     and i.exercise_id is not null
     and (i.target->>'distance_m')::int = 400 and (i.target->>'sets')::int = 8
     and i.target->>'note' = '세트간 90초';
  if not found then raise exception '가드: 매칭 운동 아이템의 target 이 기대와 다릅니다'; end if;
  -- 미매칭 운동: exercise_id null, 이름이 note 앞에 보존
  perform 1 from public.workout_template_items i
    join public.workout_templates t on t.id = i.template_id
    join public.program_days d on d.id = t.program_day_id
   where d.program_id = v_pid and d.day_index = 1 and i.seq = 2
     and i.exercise_id is null and (i.target->>'reps')::int = 12
     and i.target->>'note' = 'zz존재하지않는운동qq';
  if not found then raise exception '가드: 미매칭 운동 이름이 note 에 남지 않았습니다'; end if;
  -- 소수 무게는 유지, 음수 reps 는 버림
  perform 1 from public.workout_template_items i
    join public.workout_templates t on t.id = i.template_id
    join public.program_days d on d.id = t.program_day_id
   where d.program_id = v_pid and d.day_index = 3
     and (i.target->>'weight_kg')::numeric = 24.5 and (i.target->>'duration_s')::int = 60
     and not (i.target ? 'reps');
  if not found then raise exception '가드: 3일차 아이템 target 이 기대와 다릅니다'; end if;

  -- (b) 같은 작업 두 번 → 유니크 위반, 프로그램은 여전히 1개
  begin
    perform public.ai_materialize_program(v_uid, v_plan, v_job);
    raise exception '가드: 같은 작업으로 프로그램이 두 번 만들어집니다';
  exception when unique_violation then null;
  end;
  select count(*) into v_n from public.programs where ai_job_id = v_job;
  if v_n <> 1 then raise exception '가드: 같은 작업의 프로그램이 %개', v_n; end if;

  -- (c) 하위 저장 실패 → 상위 롤백. 1일차는 정상 저장된 뒤 3일차 아이템의
  --     exercise 가 비어 실패한다 — programs 행이 남으면 안 된다.
  v_plan := jsonb_set(v_plan, '{days,2,items,0,exercise}', '""'::jsonb);
  begin
    perform public.ai_materialize_program(v_uid, v_plan, v_job2);
    raise exception '가드: 잘못된 운동 항목인데 실체화가 성공합니다';
  exception when others then
    if sqlerrm not like 'ai_program_invalid%' then raise; end if;
  end;
  if exists (select 1 from public.programs where ai_job_id = v_job2) then
    raise exception '가드: 하위 저장 실패 뒤 상위 programs 행이 남았습니다';
  end if;
  -- exercise 키 자체가 없는 항목(빈 문자열과 다른 경로: jsonb_typeof 가 NULL)
  begin
    perform public.ai_materialize_program(v_uid,
      jsonb_build_object('title', 'x', 'days', jsonb_build_array(
        jsonb_build_object('day_index', 1, 'items', jsonb_build_array(
          jsonb_build_object('note', '운동 없음'))))),
      v_job2);
    raise exception '가드: exercise 키가 없는 항목인데 실체화가 성공합니다';
  exception when others then
    if sqlerrm not like 'ai_program_invalid%' then raise; end if;
  end;
  -- days 키 자체가 없는 출력
  begin
    perform public.ai_materialize_program(v_uid, jsonb_build_object('title', 'x'), v_job2);
    raise exception '가드: days 가 없는데 실체화가 성공합니다';
  exception when others then
    if sqlerrm not like 'ai_program_invalid%' then raise; end if;
  end;
  -- 유효한 일차가 하나도 없는 출력 → 빈 프로그램을 만들지 않는다
  begin
    perform public.ai_materialize_program(v_uid,
      jsonb_build_object('title', 'x', 'days', jsonb_build_array(jsonb_build_object('day_index', 0))),
      v_job2);
    raise exception '가드: 유효한 일차가 없는데 실체화가 성공합니다';
  exception when others then
    if sqlerrm not like 'ai_program_invalid%' then raise; end if;
  end;
  if exists (select 1 from public.programs where ai_job_id = v_job2) then
    raise exception '가드: 빈 프로그램이 남았습니다';
  end if;

  -- (d) 인사이트 교체: 같은 키로 두 번 → 1행, 내용은 두 번째
  v_ins  := public.ai_replace_insights(v_uid, 'race', v_ref, null, '첫 내용', 'guard');
  v_ins2 := public.ai_replace_insights(v_uid, 'race', v_ref, null, ' 둘째 내용 ', 'guard');
  select count(*) into v_n from public.ai_insights
   where user_id = v_uid and kind = 'race' and ref_id = v_ref;
  if v_n <> 1 then raise exception '가드: 인사이트가 %행 (1행 기대)', v_n; end if;
  perform 1 from public.ai_insights where id = v_ins2 and content = '둘째 내용';
  if not found then raise exception '가드: 교체된 인사이트 내용이 다릅니다'; end if;
  if exists (select 1 from public.ai_insights where id = v_ins) then
    raise exception '가드: 옛 인사이트가 남아 있습니다';
  end if;
  -- 실제 세션이 있으면 ai_status=done 이 같은 호출로 바뀌는지
  select id into v_sess from public.sessions
   where user_id = v_uid and deleted_at is null limit 1;
  if v_sess is not null then
    perform public.ai_replace_insights(v_uid, 'session', v_sess, null, '세션 코멘트', 'guard');
    perform 1 from public.sessions where id = v_sess and ai_status = 'done';
    if not found then raise exception '가드: 세션 ai_status 가 done 으로 바뀌지 않았습니다'; end if;
  end if;
  -- 빈 내용은 거부 (기존 인사이트를 지우지 않는다)
  begin
    perform public.ai_replace_insights(v_uid, 'race', v_ref, null, '  ', 'guard');
    raise exception '가드: 빈 내용이 저장됩니다';
  exception when others then
    if sqlerrm not like 'ai_insight_invalid%' then raise; end if;
  end;
  perform 1 from public.ai_insights where id = v_ins2;
  if not found then raise exception '가드: 빈 내용 거부 뒤 기존 인사이트가 사라졌습니다'; end if;

  -- (e) 수령 클레임: 첫 호출만 잡히고, 임대 만료 뒤에 다시 잡힌다
  insert into public.ai_jobs (kind, user_id, ref_id, job_id)
  values ('session', v_uid, gen_random_uuid(), 'guard-job') returning id into v_jid;
  select * into v_row from public.ai_jobs_claim(v_jid);
  if v_row.id is null or v_row.claim_count <> 1 or v_row.claimed_at is null then
    raise exception '가드: 첫 수령 클레임이 잡히지 않았습니다';
  end if;
  select count(*) into v_n from public.ai_jobs_claim(v_jid);
  if v_n <> 0 then raise exception '가드: 임대 중인 작업이 다시 잡힙니다'; end if;
  update public.ai_jobs set claimed_at = now() - interval '11 minutes' where id = v_jid;
  select * into v_row from public.ai_jobs_claim(v_jid);
  if v_row.id is null or v_row.claim_count <> 2 then
    raise exception '가드: 임대 만료 뒤 다시 잡히지 않았습니다';
  end if;
  update public.ai_jobs set job_id = null, claimed_at = null where id = v_jid;
  select count(*) into v_n from public.ai_jobs_claim(v_jid);
  if v_n <> 0 then raise exception '가드: 제출 전(job_id null) 작업이 수령됩니다'; end if;

  -- (f) 제출 클레임: 잡힘 → 임대 중 거부 → 만료 뒤 다시 잡힘 → 제출된 행은 거부
  v_ok := public.ai_jobs_submit_claim(v_jid);
  if not v_ok then raise exception '가드: 제출 클레임이 잡히지 않았습니다'; end if;
  v_ok := public.ai_jobs_submit_claim(v_jid);
  if v_ok then raise exception '가드: 임대 중인 요청이 다시 잡힙니다'; end if;
  update public.ai_jobs set submit_claimed_at = now() - interval '11 minutes' where id = v_jid;
  v_ok := public.ai_jobs_submit_claim(v_jid);
  if not v_ok then raise exception '가드: 제출 임대 만료 뒤 다시 잡히지 않았습니다'; end if;
  update public.ai_jobs set job_id = 'guard-job' where id = v_jid;
  v_ok := public.ai_jobs_submit_claim(v_jid);
  if v_ok then raise exception '가드: 이미 제출된 요청이 잡힙니다'; end if;

  -- (g) 권한: 내부 함수는 anon/authenticated 가 호출할 수 없다
  foreach v_fn in array array[
    'public.ai_materialize_program(uuid, jsonb, uuid)',
    'public.ai_replace_insights(uuid, text, uuid, date, text, text)',
    'public.ai_jobs_claim(uuid)',
    'public.ai_jobs_submit_claim(uuid)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '가드: % 가 anon/authenticated 에 열려 있습니다', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '가드: % 를 service_role 이 호출할 수 없습니다', v_fn;
    end if;
  end loop;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
