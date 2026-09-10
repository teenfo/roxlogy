-- ============================================================
-- Roxlogy — MCP 고도화: 회계(수단·통장 반영·기초 잔액·월 마감) + 프로그램(주간 패턴·휴식 처방)
--
-- 이번 주에 웹에 들어간 기능들이 MCP 에는 없어서, AI 로 회계를 정리하거나
-- 프로그램을 만들면 반쪽짜리 데이터가 남았다. 같은 것을 할 수 있게 맞춘다.
--
-- 시그니처가 바뀌는 함수(mcp_add_ledger, mcp_create_program)는 replace 가 아니라
-- drop 후 create 한다 — 인자만 늘리면 옛 시그니처와 오버로드가 되어 기존 호출이
-- ambiguous 로 죽는다.
-- ============================================================

-- ---------- 1) 장부 기록: 결제 수단 + 통장 반영일 --------------------------
drop function if exists public.mcp_add_ledger(text, text, text, integer, text, date, text);

create function public.mcp_add_ledger(
  p_token text, p_slug text, p_kind text, p_amount integer, p_title text,
  p_date date default app_today(), p_memo text default null,
  p_method text default null, p_settled_on date default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_id uuid;
  v_date date := coalesce(p_date, app_today());
begin
  if v_crew is null then return null; end if;
  if p_kind not in ('income', 'expense') or p_amount is null or p_amount <= 0
     or p_title is null or length(trim(p_title)) = 0 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  if p_method is not null and p_method not in ('cash','card','transfer','other') then
    return jsonb_build_object('error', 'invalid_method',
      'hint', 'method 는 cash|card|transfer|other 중 하나입니다.');
  end if;

  insert into crew_ledger
    (crew_id, entry_date, kind, amount, title, memo, method, settled_on, created_by)
  values (v_crew, v_date, p_kind, p_amount,
          left(trim(p_title), 120),
          nullif(left(trim(coalesce(p_memo, '')), 500), ''),
          p_method, p_settled_on, mcp_uid(p_token))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'entry_id', v_id,
    'date', v_date, 'kind', p_kind, 'amount', p_amount,
    'title', left(trim(p_title), 120),
    'method', p_method, 'settled_on', p_settled_on);
exception
  when others then
    if sqlerrm like '%ledger_month_closed%' then
      return jsonb_build_object('error', 'month_closed',
        'month', to_char(v_date, 'YYYY-MM'),
        'hint', '그 달은 마감되어 내역을 추가할 수 없습니다. close_crew_month 로 마감을 풀고 다시 시도하세요.');
    end if;
    raise;
end; $$;

grant execute on function
  public.mcp_add_ledger(text, text, text, integer, text, date, text, text, date)
  to anon, authenticated;

-- ---------- 2) 회계 조회: 통장 잔고·미반영·마감 상태 ------------------------
create or replace function public.mcp_crew_finance(
  p_token text, p_slug text, p_month text default null
)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name from crews c
    join crew_members m on m.crew_id = c.id
      and m.user_id = (select id from u) and m.status = 'active'
      and m.role <> 'associate'
    where c.slug = p_slug and c.status = 'active'),
  mo as (
    select case when p_month ~ '^\d{4}-\d{2}$' then p_month
                else to_char(app_today(), 'YYYY-MM') end as m),
  rng as (
    select (m || '-01')::date as f,
           ((m || '-01')::date + interval '1 month' - interval '1 day')::date as t
    from mo),
  all_rows as (
    select l.kind, l.amount, l.settled_on
    from crew_ledger l where l.crew_id = (select id from c))
  select jsonb_build_object(
    'crew', (select name from c),
    'month', (select m from mo),
    'closed', exists (select 1 from crew_month_close k
      where k.crew_id = (select id from c) and k.period = (select m from mo)),
    'month_income', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'income'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    'month_expense', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'expense'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    -- 장부 잔액 = 기록한 모든 거래
    'total_balance', coalesce(
      (select sum(case when kind = 'income' then amount else -amount end)
       from all_rows), 0),
    -- 통장 잔고 = 기초 잔액 + 통장에 찍힌 것만. 차이가 곧 미반영 금액이다.
    'bank_opening', coalesce((select opening_balance from crew_bank
      where crew_id = (select id from c)), 0),
    'bank_balance', coalesce((select opening_balance from crew_bank
      where crew_id = (select id from c)), 0) + coalesce(
      (select sum(case when kind = 'income' then amount else -amount end)
       from all_rows where settled_on is not null), 0),
    'unsettled', coalesce(
      (select sum(case when kind = 'income' then amount else -amount end)
       from all_rows where settled_on is null), 0),
    'unsettled_count', (select count(*) from crew_ledger l
      where l.crew_id = (select id from c) and l.settled_on is null
        and l.entry_date between (select f from rng) and (select t from rng)),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', l.id,
        'date', l.entry_date, 'kind', l.kind, 'amount', l.amount,
        'title', l.title, 'memo', l.memo,
        'source', l.source, 'method', l.method, 'settled_on', l.settled_on)
        order by l.entry_date desc, l.created_at desc)
      from crew_ledger l
      where l.crew_id = (select id from c)
        and l.entry_date between (select f from rng) and (select t from rng)),
      '[]'::jsonb)
  )
  from c;
$$;
grant execute on function public.mcp_crew_finance(text, text, text) to anon, authenticated;

-- ---------- 3) 통장 반영 표시 ---------------------------------------------
create or replace function public.mcp_settle_ledger(
  p_token text, p_slug text,
  p_entry_id uuid default null, p_month text default null,
  p_on date default null, p_clear boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_n int := 0;
  v_from date; v_to date;
begin
  if v_crew is null then return null; end if;
  if p_entry_id is null and p_month is null then
    return jsonb_build_object('error', 'invalid_input',
      'hint', 'entry_id 하나를 지정하거나 month(YYYY-MM)로 그 달 미반영분을 한 번에 처리하세요.');
  end if;

  if p_entry_id is not null then
    -- 날짜를 안 주면 거래일에 찍힌 것으로 본다 (제일 흔한 경우)
    update crew_ledger
       set settled_on = case when p_clear then null
                             else coalesce(p_on, entry_date) end
     where id = p_entry_id and crew_id = v_crew;
    get diagnostics v_n = row_count;
    if v_n = 0 then return jsonb_build_object('error', 'entry_not_found'); end if;
  else
    if p_month !~ '^\d{4}-\d{2}$' then
      return jsonb_build_object('error', 'invalid_period');
    end if;
    v_from := (p_month || '-01')::date;
    v_to := (v_from + interval '1 month' - interval '1 day')::date;
    update crew_ledger
       set settled_on = case when p_clear then null
                             else coalesce(p_on, entry_date) end
     where crew_id = v_crew
       and entry_date between v_from and v_to
       and (case when p_clear then settled_on is not null else settled_on is null end);
    get diagnostics v_n = row_count;
  end if;

  return jsonb_build_object('ok', true, 'updated', v_n,
    'cleared', coalesce(p_clear, false));
exception
  when others then
    if sqlerrm like '%ledger_month_closed%' then
      return jsonb_build_object('error', 'month_closed',
        'hint', '마감된 달에서도 통장 반영일은 바꿀 수 있어야 하는데 막혔습니다 — 다른 필드가 함께 바뀌었는지 확인하세요.');
    end if;
    raise;
end; $$;
grant execute on function
  public.mcp_settle_ledger(text, text, uuid, text, date, boolean)
  to anon, authenticated;

-- ---------- 4) 통장 기초 잔액 ---------------------------------------------
create or replace function public.mcp_set_bank_opening(
  p_token text, p_slug text, p_amount integer, p_on date default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug);
begin
  if v_crew is null then return null; end if;
  if p_amount is null then return jsonb_build_object('error', 'invalid_input'); end if;
  insert into crew_bank (crew_id, opening_balance, opening_on, updated_at, updated_by)
  values (v_crew, p_amount, p_on, now(), mcp_uid(p_token))
  on conflict (crew_id) do update
    set opening_balance = excluded.opening_balance,
        opening_on = excluded.opening_on,
        updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'opening_balance', p_amount, 'opening_on', p_on);
end; $$;
grant execute on function public.mcp_set_bank_opening(text, text, integer, date)
  to anon, authenticated;

-- ---------- 5) 월 마감 / 해제 ---------------------------------------------
create or replace function public.mcp_close_month(
  p_token text, p_slug text, p_period text, p_reopen boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_open int; v_unsettled int;
begin
  if v_crew is null then return null; end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('error', 'invalid_period');
  end if;

  if coalesce(p_reopen, false) then
    delete from crew_month_close where crew_id = v_crew and period = p_period;
    return jsonb_build_object('ok', true, 'period', p_period, 'closed', false);
  end if;

  select count(*) into v_open from crew_dues_charges
   where crew_id = v_crew and period = p_period and status in ('pending', 'reported');
  select count(*) into v_unsettled from crew_ledger
   where crew_id = v_crew and settled_on is null
     and entry_date between (p_period || '-01')::date
                        and ((p_period || '-01')::date + interval '1 month' - interval '1 day')::date;

  insert into crew_month_close (crew_id, period, closed_by)
  values (v_crew, p_period, mcp_uid(p_token))
  on conflict (crew_id, period) do nothing;

  return jsonb_build_object('ok', true, 'period', p_period, 'closed', true,
    'open_charges', v_open, 'unsettled_entries', v_unsettled,
    'note', '마감하면 그 달의 회비 청구와 장부 내역을 바꿀 수 없습니다. 통장 반영일만 예외입니다.');
end; $$;
grant execute on function public.mcp_close_month(text, text, text, boolean)
  to anon, authenticated;

-- ---------- 6) 처방에 휴식(rest_s) 추가 ------------------------------------
create or replace function public._mcp_insert_workouts(p_day_id uuid, p_workouts jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  w jsonb; it jsonb;
  v_tid uuid; v_eid uuid; v_seq int; v_type text;
  v_unknown text[] := '{}';
  v_sugs jsonb := '{}'::jsonb;
  v_name text; v_target jsonb;
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
      if resolve_exercise(v_name) is null and not (v_name = any(v_unknown)) then
        v_unknown := v_unknown || v_name;
        v_sugs := v_sugs || jsonb_build_object(v_name, suggest_exercises(v_name));
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
      -- 세트 사이 휴식. 처방에서 제일 자주 빠뜨리는 값이라 칸을 따로 뒀다.
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
        'rest_s', round((it->>'rest_s')::numeric)::int,
        'note', nullif(left(trim(coalesce(it->>'note', '')), 80), '')));
      insert into workout_template_items (template_id, seq, exercise_id, target)
      values (v_tid, v_seq, v_eid,
              case when v_target = '{}'::jsonb then null else v_target end);
    end loop;
  end loop;
  return null;
end; $$;
revoke execute on function public._mcp_insert_workouts(uuid, jsonb) from public;

-- ---------- 7) 프로그램 생성: 주간 패턴 ------------------------------------
drop function if exists public.mcp_create_program(text, text, int, jsonb, text, text);

create function public.mcp_create_program(
  p_token text, p_title text, p_weeks int, p_days jsonb,
  p_level text default 'intermediate', p_description text default null,
  p_week_pattern int[] default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_id uuid; v_n int := 0; v_w int := 0;
  d jsonb; v_idx int; v_day_id uuid; v_err jsonb;
  v_pat smallint[];
begin
  if v_uid is null then return null; end if;
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

  -- 먼저 전 일차의 day_index 를 검증 — 하나라도 범위를 벗어나면 만들지 않는다
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

    -- workouts 를 주지 않은 일차는 휴식일로 남는다
    if d ? 'workouts' then
      v_err := _mcp_insert_workouts(v_day_id, d->'workouts');
      if v_err is not null then
        raise exception 'MCP_WORKOUT_ERR %', v_err::text using errcode = 'P0001';
      end if;
      v_w := v_w + jsonb_array_length(d->'workouts');
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'program_id', v_id,
    'title', left(trim(p_title), 120), 'days_created', v_n,
    'workouts_created', v_w, 'week_pattern', v_pat,
    'note', '프로그램은 템플릿입니다 — 시작일·반복은 웹 시작 모달(개인) 또는 attach_crew_program(크루)에서 정합니다.');
exception
  when others then
    if sqlerrm like 'MCP_WORKOUT_ERR %' then
      return substring(sqlerrm from 17)::jsonb;
    end if;
    raise;
end; $$;
grant execute on function
  public.mcp_create_program(text, text, int, jsonb, text, text, int[])
  to anon, authenticated;

-- ---------- 8) 프로그램 기본 정보 수정 -------------------------------------
create or replace function public.mcp_update_program(
  p_token text, p_program uuid,
  p_title text default null, p_description text default null,
  p_weeks int default null, p_level text default null,
  p_is_public boolean default null, p_week_pattern int[] default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token); v_pat smallint[];
begin
  if v_uid is null then return null; end if;
  if not exists (select 1 from programs where id = p_program and owner_id = v_uid) then
    return jsonb_build_object('error', 'program_not_found_or_not_yours');
  end if;
  if p_level is not null and p_level not in ('beginner','intermediate','advanced','elite') then
    return jsonb_build_object('error', 'invalid_input', 'field', 'level');
  end if;
  if p_weeks is not null and (p_weeks < 1 or p_weeks > 20) then
    return jsonb_build_object('error', 'invalid_input', 'field', 'weeks');
  end if;
  if p_week_pattern is not null then
    if array_length(p_week_pattern, 1) is null
       or array_length(p_week_pattern, 1) > 7
       or exists (select 1 from unnest(p_week_pattern) x where x < 0 or x > 6) then
      return jsonb_build_object('error', 'invalid_week_pattern');
    end if;
    v_pat := p_week_pattern::smallint[];
  end if;

  update programs set
    title = coalesce(nullif(left(trim(coalesce(p_title, '')), 120), ''), title),
    description = case when p_description is null then description
                       else nullif(left(trim(p_description), 2000), '') end,
    weeks = coalesce(p_weeks, weeks),
    level = coalesce(p_level, level),
    is_public = coalesce(p_is_public, is_public),
    week_pattern = coalesce(v_pat, week_pattern)
  where id = p_program;

  return (select jsonb_build_object('ok', true, 'program_id', id, 'title', title,
    'weeks', weeks, 'level', level, 'is_public', is_public,
    'week_pattern', week_pattern) from programs where id = p_program);
end; $$;
grant execute on function
  public.mcp_update_program(text, uuid, text, text, int, text, boolean, int[])
  to anon, authenticated;

-- ---------- 9) 프로그램 조회: 주간 패턴·휴식일 -----------------------------
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
      'days', coalesce((select jsonb_agg(jsonb_build_object(
          'day_index', d.day_index, 'focus', d.focus, 'notes', d.notes,
          -- 워크아웃이 없는 일차 = 휴식일 (빌더의 "휴식일 추가"와 같은 상태)
          'rest', not exists (
            select 1 from workout_templates t where t.program_day_id = d.id),
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
grant execute on function public.mcp_program(text, uuid) to anon, authenticated;

-- ---------- 가드 ----------------------------------------------------------
-- 잘못된 토큰에는 아무것도 하지 않고 null 을 돌려줘야 한다 (예외를 던지면
-- MCP 클라이언트가 "서버 오류"로 받는다). 시그니처가 실제로 호출되는지도
-- 여기서 함께 확인된다.
do $$
declare v_bogus text := 'guard-token-000000000000000000';
begin
  if mcp_add_ledger(v_bogus, 'loop8', 'expense', 1000, 'x') is not null
     or mcp_settle_ledger(v_bogus, 'loop8', null, '2026-01') is not null
     or mcp_set_bank_opening(v_bogus, 'loop8', 1000) is not null
     or mcp_close_month(v_bogus, 'loop8', '2026-01') is not null
     or mcp_crew_finance(v_bogus, 'loop8') is not null
     or mcp_create_program(v_bogus, 'x', 4, '[{"day_index":1}]'::jsonb,
          'intermediate', null, array[0,2,4]) is not null
     or mcp_update_program(v_bogus, gen_random_uuid()) is not null
     or mcp_program(v_bogus, gen_random_uuid()) is not null then
    raise exception '가드: 잘못된 토큰이 통과했습니다';
  end if;
end $$;
