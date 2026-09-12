-- ============================================================
-- Roxlogy — 개인 프로그램을 여러 개 동시에 진행할 수 있게
--
-- 지금까지 "활성 등록은 1건"이었다(부분 유니크 인덱스 + rox_start_program 이 시작할 때
-- 기존 활성을 전부 해제). 그래서 두 번째 프로그램을 일정에 넣으면 첫 번째가 조용히
-- 꺼졌다 — 사용자에게는 "삭제된" 것으로 보인다.
--
-- 바꾸는 것
--   · 유니크 제약을 (user_id) → (user_id, program_id) 로. 같은 프로그램을 두 번 활성으로
--     두는 것만 막고, 서로 다른 프로그램은 얼마든지 함께 진행한다.
--   · rox_start_program: 기존 활성 해제를 없앤다. 같은 프로그램을 다시 시작하면 새 등록을
--     만들지 않고 그 등록의 날짜·반복만 갱신한다(중복 없이 "다시 시작"이 된다).
--   · rox_today_wod / mcp_today: 활성이 여럿이면 "오늘 할 것이 있는" 프로그램을 고른다.
--     mcp_today 는 today_program(단수)을 유지한 채 today_programs(복수)를 덧붙인다 —
--     반환 모양을 바꾸면 배포 전 구 버전이 깨진다(CLAUDE.md).
-- ============================================================

-- 같은 제약이 두 번 걸려 있었다(011 의 uq_active_enrollment, 063 의 재선언) — 둘 다 걷는다
drop index if exists public.uq_active_enrollment;
drop index if exists public.program_enrollments_one_active;
create unique index if not exists program_enrollments_one_active_per_program
  on public.program_enrollments(user_id, program_id) where active;

-- ---------- 시작: 다른 프로그램을 끄지 않는다 ------------------------------------
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
  v_active integer;
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

  v_end := case when v_rep then p_end else null end;
  if v_end is not null and v_end < v_start then
    return jsonb_build_object('error', 'end_before_start');
  end if;

  -- 같은 프로그램이 이미 진행 중이면 그 등록의 일정만 바꾼다(중복 등록 대신 "다시 시작").
  update program_enrollments
     set start_date = v_start, repeat = v_rep, end_date = v_end
   where user_id = p_user and program_id = p_program and active
  returning id into v_id;

  if v_id is null then
    insert into program_enrollments (user_id, program_id, start_date, repeat, end_date, active)
    values (p_user, p_program, v_start, v_rep, v_end, true)
    returning id into v_id;
  end if;

  select count(*) into v_active from program_enrollments
   where user_id = p_user and active;

  return jsonb_build_object(
    'ok', true, 'enrollment_id', v_id, 'program_id', p_program, 'program', v_title,
    'start_date', v_start, 'repeat', v_rep, 'end_date', v_end,
    'total_days', v_cyc,
    -- 지금 진행 중인 프로그램 수 — 화면이 "N개 진행 중"을 보여 줄 수 있게
    'active_programs', v_active,
    'ends_on', case when v_rep then v_end else v_start + (v_cyc - 1) end);
end;
$fn$;
revoke all on function public.rox_start_program(uuid, uuid, date, boolean, date) from public;

-- ---------- 오늘의 WOD: 활성이 여럿이면 "할 것이 있는" 프로그램 ----------------------
create or replace function public.rox_today_wod(p_user uuid, p_date date)
returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  with e as (
    select pe.program_id, pe.start_date, pe.repeat, pe.end_date
      from program_enrollments pe
     where pe.user_id = p_user and pe.active
  ), c as (
    select e.*,
           (p_date - e.start_date) as days_since,
           (select max(pd.day_index) from program_days pd
             where pd.program_id = e.program_id) as cycle_len
      from e
  ), d as (
    -- 일차 계산 규칙은 web 의 programDayNumber() 와 같아야 한다
    select c.program_id, c.cycle_len, c.start_date,
           case
             when c.days_since < 0 then null
             when c.end_date is not null and p_date > c.end_date then null
             when c.repeat then
               case when coalesce(c.cycle_len, 0) <= 0 then null
                    else (c.days_since % c.cycle_len) + 1 end
             else c.days_since + 1
           end as day_no
      from c
  )
  select jsonb_build_object(
           'day_no', d.day_no,
           'focus', pd.focus,
           'has_workout', exists (
             select 1 from workout_templates w where w.program_day_id = pd.id),
           'url', coalesce(
             (select '/workouts/' || w.id::text
                from workout_templates w
               where w.program_day_id = pd.id
               order by w.created_at limit 1),
             '/schedule'))
    from d
    join program_days pd
      on pd.program_id = d.program_id and pd.day_index = d.day_no
   where d.day_no is not null and d.day_no <= d.cycle_len
   -- 여러 프로그램이 걸리면 실제 워크아웃이 있는 쪽을, 그다음 최근에 시작한 쪽을 고른다
   order by exists (select 1 from workout_templates w where w.program_day_id = pd.id) desc,
            d.start_date desc
   limit 1;
$fn$;

-- ---------- MCP 오늘: today_program(단수) 유지 + today_programs(복수) 추가 -----------
create or replace function public.mcp_today(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  with u as (select mcp_uid(p_token) as id),
  t as (select app_today() as d),
  en as (
    select pe.start_date, pe.end_date, pe.repeat, p.id as pid, p.title,
           (select max(d.day_index) from program_days d where d.program_id = p.id) as cyc
    from program_enrollments pe join programs p on p.id = pe.program_id
    where pe.user_id = (select id from u) and pe.active),
  prog as (
    select e.pid, e.title, e.start_date,
      case
        when (select d from t) < e.start_date then null
        when e.end_date is not null and (select d from t) > e.end_date then null
        when e.repeat and coalesce(e.cyc, 0) > 0
          then (((select d from t) - e.start_date) % e.cyc) + 1
        when not e.repeat and ((select d from t) - e.start_date) < coalesce(e.cyc, 0)
          then ((select d from t) - e.start_date) + 1
        else null
      end as day_idx
    from en e),
  today_rows as (
    select pr.title, pr.day_idx, pr.start_date, d.id as day_id, d.focus
    from prog pr
    join program_days d on d.program_id = pr.pid and d.day_index = pr.day_idx
    where pr.day_idx is not null)
  select jsonb_build_object(
    'today', (select d from t),
    -- 구 버전 호환: 대표 프로그램 하나(워크아웃 있는 쪽 우선)
    'today_program', (
      select jsonb_build_object(
        'program', r.title, 'day', r.day_idx, 'focus', r.focus,
        'workouts', coalesce((
          select jsonb_agg(jsonb_build_object('title', w.title, 'type', w.type))
          from workout_templates w where w.program_day_id = r.day_id), '[]'::jsonb))
      from today_rows r
      order by exists (select 1 from workout_templates w where w.program_day_id = r.day_id) desc,
               r.start_date desc
      limit 1),
    -- 진행 중인 프로그램이 여럿일 수 있다
    'today_programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'program', r.title, 'day', r.day_idx, 'focus', r.focus,
        'workouts', coalesce((
          select jsonb_agg(jsonb_build_object('title', w.title, 'type', w.type))
          from workout_templates w where w.program_day_id = r.day_id), '[]'::jsonb))
        order by r.start_date desc)
      from today_rows r), '[]'::jsonb),
    'crew_meetups_14d', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
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
        and rp.race_date between (select d from t) and (select d from t) + 30), '[]'::jsonb)
  )
  from u where u.id is not null;
$fn$;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_user uuid; v_p1 uuid; v_p2 uuid; j jsonb; v_n int; v_d1 uuid; v_d2 uuid;
begin
  select id into v_user from public.profiles where not disabled limit 1;
  if v_user is null then raise notice '가드 건너뜀: 계정 없음'; return; end if;

  -- 일차가 있는 프로그램 두 개를 만든다
  insert into public.programs (owner_id, title) values (v_user, '가드 프로그램 A') returning id into v_p1;
  insert into public.programs (owner_id, title) values (v_user, '가드 프로그램 B') returning id into v_p2;
  insert into public.program_days (program_id, day_index, focus) values (v_p1, 1, 'A1') returning id into v_d1;
  insert into public.program_days (program_id, day_index, focus) values (v_p2, 1, 'B1') returning id into v_d2;

  -- 두 개를 잇달아 시작하면 둘 다 살아 있어야 한다
  j := public.rox_start_program(v_user, v_p1, app_today(), false, null);
  if j->>'ok' is distinct from 'true' then raise exception '가드: A 시작 실패 %', j; end if;
  j := public.rox_start_program(v_user, v_p2, app_today(), false, null);
  if j->>'ok' is distinct from 'true' then raise exception '가드: B 시작 실패 %', j; end if;
  select count(*) into v_n from public.program_enrollments where user_id = v_user and active;
  if v_n < 2 then raise exception '가드: 두 번째 프로그램이 첫 번째를 껐다 (활성 %건)', v_n; end if;
  if (j->>'active_programs')::int < 2 then raise exception '가드: active_programs 이상 %', j; end if;

  -- 같은 프로그램을 다시 시작하면 중복 등록이 아니라 일정 갱신
  j := public.rox_start_program(v_user, v_p2, app_today() + 3, false, null);
  select count(*) into v_n from public.program_enrollments
   where user_id = v_user and program_id = v_p2 and active;
  if v_n <> 1 then raise exception '가드: 같은 프로그램이 중복 등록됐다 (%건)', v_n; end if;
  if (select start_date from public.program_enrollments
       where user_id = v_user and program_id = v_p2 and active) <> app_today() + 3 then
    raise exception '가드: 다시 시작이 일정을 바꾸지 않았다'; end if;

  -- 하나만 중지하면 나머지는 남는다
  j := public.rox_stop_program(v_user, v_p1);
  if j->>'ok' is distinct from 'true' then raise exception '가드: A 중지 실패 %', j; end if;
  select count(*) into v_n from public.program_enrollments where user_id = v_user and active;
  if v_n <> 1 then raise exception '가드: 하나를 중지했는데 활성이 %건', v_n; end if;

  -- 오늘의 WOD 는 활성이 여럿이어도 하나를 고른다(터지지 않는다)
  j := public.rox_start_program(v_user, v_p1, app_today(), false, null);
  j := public.rox_today_wod(v_user, app_today());
  if j is null or (j->>'day_no') is null then raise exception '가드: 오늘의 WOD 를 못 골랐다 %', j; end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
