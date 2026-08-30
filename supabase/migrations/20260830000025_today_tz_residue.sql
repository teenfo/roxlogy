-- Roxlogy — '오늘' 타임존 잔여 통일 + 이벤트 트리거 search_path 고정
--
-- 20260830000015 에서 웹·mcp_today·program_calendar·mcp_crew_finance 를 app_today()(KST)
-- 로 옮겼지만, MCP 쓰기·조회 4개 함수가 current_date(UTC) 를 그대로 쓰고 있었다.
-- KST 자정~오전 9시 사이에 MCP 로 장부를 적거나 회비를 확정하면 '어제' 날짜로
-- 기록되고, 크루 일정 기본 창도 하루 밀린다.
--
-- 주의: 인자 DEFAULT 식은 함수 본문과 달리 **호출자 권한으로** 평가된다.
-- SECURITY DEFINER 라도 anon/authenticated 가 app_today() 를 실행할 수 없으면
-- 인자를 생략한 호출이 permission denied 로 죽는다 → app_today() 실행 권한 부여.
-- (내용은 `select current_date` 수준의 무해한 날짜 계산이라 노출 위험 없음)

grant execute on function public.app_today() to anon, authenticated;

comment on function public.app_today() is
  'KST 기준 오늘 날짜. 서버측 "오늘" 판정의 단일 출처 — current_date(UTC) 를 쓰지 말 것. '
  '인자 DEFAULT 식이 호출자 권한으로 평가되므로 anon·authenticated 에 execute 를 부여했다.';

-- ---------- 1) mcp_add_ledger: 장부 기입일 기본값
create or replace function public.mcp_add_ledger(
  p_token text, p_slug text, p_kind text, p_amount integer, p_title text,
  p_date date default app_today(), p_memo text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_id uuid;
begin
  if v_crew is null then return null; end if;
  if p_kind not in ('income', 'expense') or p_amount is null or p_amount <= 0
     or p_title is null or length(trim(p_title)) = 0 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  insert into crew_ledger (crew_id, entry_date, kind, amount, title, memo, created_by)
  values (v_crew, coalesce(p_date, app_today()), p_kind, p_amount,
          left(trim(p_title), 120), nullif(left(trim(coalesce(p_memo, '')), 500), ''),
          mcp_uid(p_token))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'entry_id', v_id,
    'date', coalesce(p_date, app_today()), 'kind', p_kind,
    'amount', p_amount, 'title', left(trim(p_title), 120));
end;
$function$;

-- ---------- 2) mcp_attach_crew_program: 크루 프로그램 시작일 기본값
create or replace function public.mcp_attach_crew_program(
  p_token text, p_slug text, p_program uuid,
  p_start_date date default app_today(), p_end_date date default null,
  p_repeat boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_uid uuid := mcp_uid(p_token);
begin
  if v_crew is null then return null; end if;
  if not exists (select 1 from programs p
                 where p.id = p_program and (p.owner_id = v_uid or p.is_public)) then
    return jsonb_build_object('error', 'program_not_found_or_not_yours');
  end if;
  insert into crew_program_enrollments
    (crew_id, program_id, start_date, end_date, repeat, created_by)
  values (v_crew, p_program, coalesce(p_start_date, app_today()), p_end_date,
          coalesce(p_repeat, false), v_uid)
  on conflict (crew_id, program_id) do update
    set start_date = excluded.start_date, end_date = excluded.end_date,
        repeat = excluded.repeat;
  return jsonb_build_object('ok', true, 'crew', p_slug, 'program_id', p_program,
    'start_date', coalesce(p_start_date, app_today()), 'end_date', p_end_date,
    'repeat', coalesce(p_repeat, false));
end; $function$;

-- ---------- 3) mcp_set_dues_paid: 회비 확정 시 자동 장부 기입일
create or replace function public.mcp_set_dues_paid(
  p_token text, p_slug text, p_user_id uuid, p_month text,
  p_amount integer default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_uid uuid := mcp_uid(p_token);
  v_status text;
  v_name text;
begin
  if v_crew is null then return null; end if;
  if p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('error', 'invalid_month');
  end if;
  if p_amount is not null and p_amount <= 0 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;
  if not exists (select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = p_user_id and m.status = 'active') then
    return jsonb_build_object('error', 'not_a_member');
  end if;

  select status into v_status from crew_dues_payments
  where crew_id = v_crew and user_id = p_user_id and period = p_month;
  if v_status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;

  insert into crew_dues_payments
    (crew_id, user_id, period, status, amount, confirmed_at, confirmed_by)
  values (v_crew, p_user_id, p_month, 'confirmed', p_amount, now(), v_uid)
  on conflict (crew_id, user_id, period) do update
    set status = 'confirmed',
        amount = coalesce(excluded.amount, crew_dues_payments.amount),
        confirmed_at = now(), confirmed_by = v_uid;

  if p_amount is not null then
    select display_name into v_name from profiles where id = p_user_id;
    insert into crew_ledger (crew_id, entry_date, kind, amount, title, source, created_by)
    values (v_crew, app_today(), 'income', p_amount,
            p_month || ' 회비 — ' || coalesce(v_name, '멤버'), 'dues', v_uid);
  end if;

  return jsonb_build_object('ok', true, 'month', p_month, 'amount', p_amount,
    'ledger_recorded', p_amount is not null);
end; $function$;

-- ---------- 4) mcp_crew_schedule: 조회 창 기본값 (본문은 이미 Asia/Seoul)
create or replace function public.mcp_crew_schedule(
  p_token text, p_slug text,
  p_from date default app_today(), p_to date default (app_today() + 30))
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name,
      exists (select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active' and m.role <> 'associate') as full_member
    from crews c
    where c.slug = p_slug and c.status = 'active'
      and (c.is_public or exists (
        select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active')))
  select jsonb_build_object(
    'crew', (select name from c),
    'from', p_from, 'to', p_to,
    'meetups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'title', e.title, 'starts_at', e.starts_at, 'location', e.location,
        'members_only', e.members_only, 'capacity', e.capacity,
        'going', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'going'),
        'waitlisted', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'waitlisted'))
        order by e.starts_at)
      from crew_events e where e.crew_id = (select id from c)
        and e.cancelled_at is null
        and (not e.members_only or (select full_member from c))
        and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to),
      '[]'::jsonb),
    'member_races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', rp.title, 'race_date', rp.race_date,
        'member', pr.display_name,
        'division', rp.division, 'bib', rp.bib,
        'result_ms', (select r.total_time_ms from race_results r
                      where r.user_id = rp.user_id
                        and r.event_date between rp.race_date - 3 and rp.race_date + 3
                      order by r.total_time_ms asc nulls last limit 1))
        order by rp.race_date, rp.bib nulls last)
      from race_plans rp
      join crew_members m on m.user_id = rp.user_id
        and m.crew_id = (select id from c) and m.status = 'active'
      join profiles pr on pr.id = rp.user_id
      where rp.race_date between p_from and p_to), '[]'::jsonb),
    'crew_programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', p.title, 'start_date', pe.start_date,
        'end_date', pe.end_date, 'repeats', pe.repeat))
      from crew_program_enrollments pe
      join programs p on p.id = pe.program_id
      where pe.crew_id = (select id from c)), '[]'::jsonb)
  )
  from c;
$function$;

-- ---------- 5) 이벤트 트리거 함수 search_path 고정 (advisor: function_search_path_mutable)
-- 이 함수는 CREATE FUNCTION 직후 PUBLIC 실행 권한을 회수하는 잠금 장치다.
-- search_path 가 열려 있으면 악의적 스키마가 format/execute 경로를 가로챌 수 있다.
create or replace function public.rox_lock_new_functions()
returns event_trigger language plpgsql
set search_path to 'public', 'pg_catalog'
as $fn$
declare r record;
begin
  for r in select * from pg_event_trigger_ddl_commands()
           where command_tag = 'CREATE FUNCTION' and schema_name = 'public'
  loop
    execute format('revoke execute on function %s from public', r.object_identity);
  end loop;
end $fn$;

-- ---------- 6) 문서화: ai_jobs 는 정책 없는 RLS 가 의도된 상태
comment on table public.ai_jobs is
  'AI 잡 클레임 큐 — service_role(Edge analysis-dispatch) 전용. RLS 활성 + 정책 0개는 '
  '의도된 설계(클라이언트 전면 차단). advisor 의 rls_enabled_no_policy INFO 는 무시해도 된다.';

-- ---------- 가드: public 함수에 current_date 잔재가 없어야 한다
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prokind = 'f'
    and lower(pg_get_functiondef(p.oid)) like '%current_date%';
  if n > 0 then
    raise exception 'current_date remains in % public function(s) — app_today() 로 교체할 것', n;
  end if;
end $$;
