-- ============================================================
-- Roxlogy — 시스템 감사 수리 (3) '오늘' 타임존 통일 · ICS 구조화 처방
--
-- 1) '오늘' 기준이 갈려 있었다: 개인 프로그램 일차는 서버/DB UTC,
--    크루 모임·회비는 Asia/Seoul. 한국어 우선 앱에서 KST 사용자는
--    자정~오전 9시 사이에 전날 WOD 를 보게 된다. app_today() 로 통일
--    (웹은 사용자 tz 쿠키, 폴백 KST — lib/format.ts todayISOIn).
-- 2) program_calendar 가 아이템 처방을 note 만 반환해, 구조화 이관
--    (20260830000011) 이후 캘린더 구독에서 '400m × 8세트' 같은 수치가
--    통째로 빠졌다. target 전체를 반환하도록 수정.
-- 3) mcp_crew_finance 의 기본 월도 KST 로 맞춰 회비(mcp_dues)와 대조 가능하게.
--
-- app_today() 는 SECURITY DEFINER 함수 내부에서만 쓰이므로 클라이언트
-- 실행 권한을 주지 않는다 (20260830000013 이후 기본값 = 권한 없음).
-- ============================================================

create or replace function public.app_today()
returns date
language sql stable set search_path to 'public' as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

comment on function public.app_today() is
  'Roxlogy 기준 오늘(Asia/Seoul). 프로그램 일차·크루 일정·회비 판정의 단일 기준.';

-- ---------- 1) mcp_today: current_date(UTC) → app_today()(KST)
create or replace function public.mcp_today(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  t as (select app_today() as d),
  en as (
    select pe.start_date, pe.end_date, pe.repeat, p.id as pid, p.title,
           (select max(d.day_index) from program_days d where d.program_id = p.id) as cyc
    from program_enrollments pe join programs p on p.id = pe.program_id
    where pe.user_id = (select id from u) and pe.active limit 1),
  prog as (
    select e.pid, e.title,
      case
        when (select d from t) < e.start_date then null
        when e.end_date is not null and (select d from t) > e.end_date then null
        when e.repeat and coalesce(e.cyc, 0) > 0
          then (((select d from t) - e.start_date) % e.cyc) + 1
        when not e.repeat and ((select d from t) - e.start_date) < coalesce(e.cyc, 0)
          then ((select d from t) - e.start_date) + 1
        else null
      end as day_idx
    from en e)
  select jsonb_build_object(
    'today', (select d from t),
    'today_program', (
      select jsonb_build_object(
        'program', pr.title, 'day', pr.day_idx, 'focus', d.focus,
        'workouts', coalesce((
          select jsonb_agg(jsonb_build_object('title', w.title, 'type', w.type))
          from workout_templates w where w.program_day_id = d.id), '[]'::jsonb))
      from prog pr
      join program_days d on d.program_id = pr.pid and d.day_index = pr.day_idx
      where pr.day_idx is not null),
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
$$;
grant execute on function public.mcp_today(text) to anon, authenticated;

-- ---------- 2) program_calendar: 아이템 처방을 target 전체로 반환
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
                  'name_ko', e.name_ko,
                  'name_en', e.name_en
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
    from programs p where p.id = p_id);
end;
$$;
grant execute on function public.program_calendar(uuid, text) to anon, authenticated;

-- ---------- 3) mcp_crew_finance 기본 월도 KST 기준
-- (기존 정의 그대로, mo 의 current_date 만 app_today() 로 교체)
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
    from mo)
  select jsonb_build_object(
    'crew', (select name from c),
    'month', (select m from mo),
    'month_income', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'income'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    'month_expense', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'expense'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    'total_balance', coalesce((select sum(case when kind = 'income' then amount
                                               else -amount end)
      from crew_ledger where crew_id = (select id from c)), 0),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', l.entry_date, 'kind', l.kind, 'amount', l.amount,
        'title', l.title, 'memo', l.memo) order by l.entry_date desc)
      from crew_ledger l
      where l.crew_id = (select id from c)
        and l.entry_date between (select f from rng) and (select t from rng)),
      '[]'::jsonb)
  )
  from c;
$$;
grant execute on function public.mcp_crew_finance(text, text, text)
  to anon, authenticated;
