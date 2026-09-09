-- ============================================================
-- Roxlogy — 개인 프로그램 시작·중지를 RPC 로 (웹 + MCP 공용)
--
-- 두 가지를 고친다.
--
-- 1) MCP 에서 개인 프로그램을 시작할 수 없었다. 프로그램 생성(create_program)과
--    크루 연결(attach_crew_program)은 열려 있는데, "내 일정으로 시작"만 웹 모달
--    전용이라 AI 로 훈련 계획을 짜 놓고도 마지막 한 걸음을 사람이 웹에서 눌러야
--    했다.
--
-- 2) 웹 모달의 시작 로직이 원자적이지 않았다. 기존 활성 해제 → 새 등록 삽입을
--    클라이언트가 두 번 호출하고, 삽입이 실패하면 손으로 되돌렸다. 그 사이에
--    브라우저가 닫히거나 네트워크가 끊기면 진행 중이던 프로그램이 조용히 꺼진
--    채 남는다. 한 함수(=한 트랜잭션) 안으로 옮긴다.
--
-- "활성 등록은 1건" 도 앱 코드의 약속일 뿐이었다 — 부분 유니크 인덱스로 실제
-- 제약으로 만든다.
-- ============================================================

create unique index if not exists program_enrollments_one_active
  on public.program_enrollments(user_id) where active;

-- 프로그램 가시성 — mcp_program 과 같은 규칙(본인 소유 / 공개 / 내 크루 연결)
create or replace function public.rox_program_visible(p_user uuid, p_program uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $fn$
  select exists (
    select 1 from programs p
    where p.id = p_program
      and (p.owner_id = p_user or p.is_public or exists (
        select 1 from crew_program_enrollments e
        join crew_members m on m.crew_id = e.crew_id
          and m.user_id = p_user and m.status = 'active'
        where e.program_id = p.id)));
$fn$;
revoke all on function public.rox_program_visible(uuid, uuid) from public;

create or replace function public.rox_start_program(
  p_user uuid, p_program uuid, p_start date,
  p_repeat boolean, p_end date
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_cyc integer;
  v_start date := coalesce(p_start, app_today());
  v_rep boolean := coalesce(p_repeat, false);
  v_end date;
  v_id uuid;
  v_title text;
begin
  if p_user is null then return null; end if;
  if not public.rox_program_visible(p_user, p_program) then
    return jsonb_build_object('error', 'program_not_found_or_hidden');
  end if;

  select p.title, (select max(d.day_index) from program_days d where d.program_id = p.id)
    into v_title, v_cyc
    from programs p where p.id = p_program;
  if coalesce(v_cyc, 0) = 0 then
    return jsonb_build_object('error', 'program_has_no_days');
  end if;

  -- 반복일 때만 종료일을 저장한다(비우면 중지할 때까지 무기한).
  -- 비반복은 일차 수만큼 돌고 스스로 끝나므로 end_date 를 두지 않는다 — 웹과 동일.
  v_end := case when v_rep then p_end else null end;
  if v_end is not null and v_end < v_start then
    return jsonb_build_object('error', 'end_before_start');
  end if;

  update program_enrollments set active = false
   where user_id = p_user and active;

  insert into program_enrollments (user_id, program_id, start_date, repeat, end_date, active)
  values (p_user, p_program, v_start, v_rep, v_end, true)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'enrollment_id', v_id, 'program_id', p_program, 'program', v_title,
    'start_date', v_start, 'repeat', v_rep, 'end_date', v_end,
    'total_days', v_cyc,
    -- 확인용: 비반복이면 마지막 일차 날짜, 반복이면 지정 종료일(없으면 null)
    'ends_on', case when v_rep then v_end else v_start + (v_cyc - 1) end);
end;
$fn$;
revoke all on function public.rox_start_program(uuid, uuid, date, boolean, date) from public;

create or replace function public.rox_stop_program(p_user uuid, p_program uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_title text;
begin
  if p_user is null then return null; end if;
  select p.title into v_title
    from program_enrollments pe join programs p on p.id = pe.program_id
   where pe.user_id = p_user and pe.active
     and (p_program is null or pe.program_id = p_program);
  if v_title is null then
    return jsonb_build_object('error', 'no_active_enrollment');
  end if;
  update program_enrollments set active = false
   where user_id = p_user and active
     and (p_program is null or program_id = p_program);
  return jsonb_build_object('ok', true, 'stopped', v_title);
end;
$fn$;
revoke all on function public.rox_stop_program(uuid, uuid) from public;

-- 웹용 (auth.uid())
create or replace function public.start_program(
  p_program uuid, p_start_date date default app_today(),
  p_repeat boolean default false, p_end_date date default null
)
returns jsonb
language sql security definer set search_path to 'public' as $fn$
  select public.rox_start_program(
    (select auth.uid()), p_program, p_start_date, p_repeat, p_end_date);
$fn$;

create or replace function public.stop_program(p_program uuid default null)
returns jsonb
language sql security definer set search_path to 'public' as $fn$
  select public.rox_stop_program((select auth.uid()), p_program);
$fn$;

-- MCP 용 (토큰)
create or replace function public.mcp_start_program(
  p_token text, p_program uuid, p_start_date date default null,
  p_repeat boolean default false, p_end_date date default null
)
returns jsonb
language sql security definer set search_path to 'public' as $fn$
  select public.rox_start_program(
    mcp_uid(p_token), p_program, coalesce(p_start_date, app_today()),
    p_repeat, p_end_date);
$fn$;

create or replace function public.mcp_stop_program(
  p_token text, p_program uuid default null
)
returns jsonb
language sql security definer set search_path to 'public' as $fn$
  select public.rox_stop_program(mcp_uid(p_token), p_program);
$fn$;

grant execute on function public.start_program(uuid, date, boolean, date) to authenticated;
grant execute on function public.stop_program(uuid) to authenticated;
grant execute on function public.mcp_start_program(text, uuid, date, boolean, date) to anon, authenticated;
grant execute on function public.mcp_stop_program(text, uuid) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $guard$
declare
  v_a uuid; v_b uuid; v_p1 uuid; v_p2 uuid; v_hidden uuid; v_empty uuid;
  v_r jsonb; v_n int;
begin
  select id into v_a from public.profiles order by created_at limit 1;
  select id into v_b from public.profiles where id <> v_a order by created_at limit 1;
  if v_a is null or v_b is null then return; end if;

  insert into programs (owner_id, title, is_public) values (v_a, 'G1', false) returning id into v_p1;
  insert into programs (owner_id, title, is_public) values (v_a, 'G2', false) returning id into v_p2;
  insert into programs (owner_id, title, is_public) values (v_b, 'H', false) returning id into v_hidden;
  insert into programs (owner_id, title, is_public) values (v_a, 'EMPTY', false) returning id into v_empty;
  insert into program_days (program_id, day_index) select v_p1, g from generate_series(1,7) g;
  insert into program_days (program_id, day_index) select v_p2, g from generate_series(1,7) g;
  insert into program_days (program_id, day_index) select v_hidden, g from generate_series(1,7) g;

  -- 남의 비공개 프로그램은 시작할 수 없다
  v_r := public.rox_start_program(v_a, v_hidden, app_today(), false, null);
  if v_r->>'error' <> 'program_not_found_or_hidden' then
    raise exception '가드: 남의 비공개 프로그램이 시작됐습니다 (%)', v_r::text;
  end if;

  -- 정상 시작 — 비반복이면 end_date 는 저장하지 않고 ends_on 만 계산해 준다
  v_r := public.rox_start_program(v_a, v_p1, app_today(), false, null);
  if (v_r->>'ok') is null then raise exception '가드: 시작 실패 (%)', v_r::text; end if;
  if (v_r->>'ends_on')::date <> app_today() + 6 then
    raise exception '가드: ends_on 이 시작+6 이 아닙니다 (%)', v_r->>'ends_on';
  end if;
  if v_r->>'end_date' is not null then
    raise exception '가드: 비반복인데 end_date 가 저장됐습니다';
  end if;

  -- 두 번째 시작 → 첫 번째 자동 해제, 활성은 항상 1건
  v_r := public.rox_start_program(v_a, v_p2, app_today(), true, app_today() + 30);
  if (v_r->>'ok') is null then raise exception '가드: 두 번째 시작 실패 (%)', v_r::text; end if;
  select count(*) into v_n from program_enrollments where user_id = v_a and active;
  if v_n <> 1 then raise exception '가드: 활성 등록이 % 건입니다', v_n; end if;
  if (select program_id from program_enrollments where user_id = v_a and active) <> v_p2 then
    raise exception '가드: 활성 프로그램이 교체되지 않았습니다';
  end if;

  -- 반복인데 종료일이 시작보다 앞 → 거부되고, 직전 활성은 그대로여야 한다
  -- (해제만 되고 삽입이 실패하는 옛 웹 동작이 재발하면 여기서 걸린다)
  v_r := public.rox_start_program(v_a, v_p1, app_today(), true, app_today() - 1);
  if v_r->>'error' <> 'end_before_start' then
    raise exception '가드: 잘못된 날짜 범위가 통과했습니다 (%)', v_r::text;
  end if;
  select count(*) into v_n from program_enrollments where user_id = v_a and active;
  if v_n <> 1 then raise exception '가드: 실패 후 활성 등록이 % 건입니다', v_n; end if;

  -- 일차 없는 프로그램
  v_r := public.rox_start_program(v_a, v_empty, app_today(), false, null);
  if v_r->>'error' <> 'program_has_no_days' then
    raise exception '가드: 빈 프로그램이 시작됐습니다 (%)', v_r::text;
  end if;

  -- 중지
  v_r := public.rox_stop_program(v_a, null);
  if (v_r->>'ok') is null then raise exception '가드: 중지 실패 (%)', v_r::text; end if;
  select count(*) into v_n from program_enrollments where user_id = v_a and active;
  if v_n <> 0 then raise exception '가드: 중지 후에도 활성이 % 건입니다', v_n; end if;
  v_r := public.rox_stop_program(v_a, null);
  if v_r->>'error' <> 'no_active_enrollment' then
    raise exception '가드: 중지할 게 없는데 성공했습니다 (%)', v_r::text;
  end if;

  -- 내부 헬퍼는 클라이언트에 노출되면 안 된다
  if has_function_privilege('anon', 'public.rox_start_program(uuid, uuid, date, boolean, date)', 'execute')
     or has_function_privilege('authenticated', 'public.rox_start_program(uuid, uuid, date, boolean, date)', 'execute')
     or has_function_privilege('anon', 'public.rox_program_visible(uuid, uuid)', 'execute') then
    raise exception '가드: 검증 없는 내부 헬퍼가 노출됐습니다';
  end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm <> '__guard_rollback__' then raise; end if;
end $guard$;
