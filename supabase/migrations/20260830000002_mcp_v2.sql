-- ============================================================
-- Roxlogy — MCP v2: 훈련 프로그램 등록 + 크루 기능 고도화
--
-- 프로그램: 목록/상세 조회, 생성(일차 일괄), 일차 수정, 크루 연결.
-- 크루: 멤버 목록, 모임 수정·취소, 참석 체크(RSVP), 게시판 읽기,
--       회비 현황(본인/운영진), 납부 확정, 납부 셀프 신고.
-- 모든 함수가 토큰(mcp_uid)으로 사용자·권한을 SQL 안에서 검증한다.
-- ============================================================

-- 토큰 사용자가 활성 멤버인 크루 id (아니면 null)
create or replace function public.mcp_member_crew(p_token text, p_slug text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select c.id from crews c
  join crew_members m on m.crew_id = c.id
    and m.user_id = mcp_uid(p_token) and m.status = 'active'
  where c.slug = p_slug and c.status = 'active';
$$;

-- ---------- 1) 내 프로그램 목록
create or replace function public.mcp_my_programs(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'weeks', p.weeks, 'level', p.level,
      'start_date', p.start_date, 'repeats', p.repeat_enabled,
      'day_count', (select count(*) from program_days d where d.program_id = p.id),
      'crews', coalesce((select jsonb_agg(c.slug)
        from crew_program_enrollments e join crews c on c.id = e.crew_id
        where e.program_id = p.id), '[]'::jsonb)
    ) order by p.created_at desc)
    from programs p where p.owner_id = v_uid), '[]'::jsonb);
end; $$;

-- ---------- 2) 프로그램 상세 (소유자 또는 연결 크루의 멤버)
create or replace function public.mcp_program(p_token text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return (
    select jsonb_build_object(
      'id', p.id, 'title', p.title, 'description', p.description,
      'weeks', p.weeks, 'level', p.level, 'start_date', p.start_date,
      'repeats', p.repeat_enabled,
      'days', coalesce((select jsonb_agg(jsonb_build_object(
          'day_index', d.day_index, 'focus', d.focus, 'notes', d.notes)
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

-- ---------- 3) 프로그램 생성 (일차 일괄 등록)
-- p_days: [{"day_index":1,"focus":"...","notes":"..."}, ...]
create or replace function public.mcp_create_program(
  p_token text, p_title text, p_weeks int, p_days jsonb,
  p_level text default 'intermediate', p_description text default null,
  p_start_date date default null, p_repeat boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_id uuid;
  v_n int := 0;
  d jsonb;
  v_idx int;
begin
  if v_uid is null then return null; end if;
  if p_title is null or length(trim(p_title)) = 0
     or p_weeks is null or p_weeks < 1 or p_weeks > 20
     or p_level not in ('beginner', 'intermediate', 'advanced', 'elite')
     or p_days is null or jsonb_typeof(p_days) <> 'array'
     or jsonb_array_length(p_days) = 0 or jsonb_array_length(p_days) > 140 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  insert into programs (owner_id, title, description, weeks, level,
                        start_date, repeat_enabled, is_public)
  values (v_uid, left(trim(p_title), 120),
          nullif(left(trim(coalesce(p_description, '')), 2000), ''),
          p_weeks, p_level, p_start_date, coalesce(p_repeat, false), false)
  returning id into v_id;

  for d in select * from jsonb_array_elements(p_days) loop
    v_idx := (d->>'day_index')::int;
    if v_idx is null or v_idx < 1 or v_idx > p_weeks * 7 then
      continue;
    end if;
    insert into program_days (program_id, day_index, focus, notes)
    values (v_id, v_idx,
            nullif(left(trim(coalesce(d->>'focus', '')), 200), ''),
            nullif(left(trim(coalesce(d->>'notes', '')), 2000), ''));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'program_id', v_id,
    'title', left(trim(p_title), 120), 'days_created', v_n);
end; $$;

-- ---------- 4) 프로그램 일차 수정 (소유자 전용, 업서트 / 둘 다 null 이면 삭제)
create or replace function public.mcp_set_program_day(
  p_token text, p_program uuid, p_day_index int,
  p_focus text default null, p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_weeks int;
begin
  if v_uid is null then return null; end if;
  select weeks into v_weeks from programs
  where id = p_program and owner_id = v_uid;
  if v_weeks is null then return null; end if;
  if p_day_index is null or p_day_index < 1 or p_day_index > v_weeks * 7 then
    return jsonb_build_object('error', 'invalid_day_index');
  end if;

  if p_focus is null and p_notes is null then
    delete from program_days where program_id = p_program and day_index = p_day_index;
    return jsonb_build_object('ok', true, 'day_index', p_day_index, 'deleted', true);
  end if;

  update program_days
  set focus = nullif(left(trim(coalesce(p_focus, '')), 200), ''),
      notes = nullif(left(trim(coalesce(p_notes, '')), 2000), '')
  where program_id = p_program and day_index = p_day_index;
  if not found then
    insert into program_days (program_id, day_index, focus, notes)
    values (p_program, p_day_index,
            nullif(left(trim(coalesce(p_focus, '')), 200), ''),
            nullif(left(trim(coalesce(p_notes, '')), 2000), ''));
  end if;
  return jsonb_build_object('ok', true, 'day_index', p_day_index);
end; $$;

-- ---------- 5) 크루에 프로그램 연결 (운영진, 본인 소유/공개 프로그램만)
create or replace function public.mcp_attach_crew_program(
  p_token text, p_slug text, p_program uuid,
  p_start_date date default current_date, p_end_date date default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_uid uuid := mcp_uid(p_token);
begin
  if v_crew is null then return null; end if;
  if not exists (select 1 from programs p
                 where p.id = p_program and (p.owner_id = v_uid or p.is_public)) then
    return jsonb_build_object('error', 'program_not_found_or_not_yours');
  end if;
  insert into crew_program_enrollments (crew_id, program_id, start_date, end_date, created_by)
  values (v_crew, p_program, coalesce(p_start_date, current_date), p_end_date, v_uid)
  on conflict (crew_id, program_id) do update
    set start_date = excluded.start_date, end_date = excluded.end_date;
  return jsonb_build_object('ok', true, 'crew', p_slug, 'program_id', p_program,
    'start_date', coalesce(p_start_date, current_date), 'end_date', p_end_date);
end; $$;

-- ---------- 6) 크루 멤버 목록 (멤버: 활성 명단 / 운영진: user_id·대기자 포함)
create or replace function public.mcp_crew_members(p_token text, p_slug text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_member_crew(p_token, p_slug);
  v_staff boolean := mcp_staff_crew(p_token, p_slug) is not null;
begin
  if v_crew is null then return null; end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg((jsonb_build_object(
          'name', coalesce(pr.display_name, 'Athlete'),
          'role', m.role, 'joined_at', m.joined_at)
        || case when v_staff
             then jsonb_build_object('user_id', m.user_id) else '{}'::jsonb end)
        order by array_position(array['owner','coach','member','associate'], m.role), m.joined_at)
      from crew_members m join profiles pr on pr.id = m.user_id
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb),
    'pending', case when v_staff then coalesce((
      select jsonb_agg(jsonb_build_object(
          'user_id', m.user_id,
          'name', coalesce(pr.display_name, 'Athlete'),
          'requested_at', m.joined_at) order by m.joined_at)
      from crew_members m join profiles pr on pr.id = m.user_id
      where m.crew_id = v_crew and m.status = 'pending'), '[]'::jsonb)
      else null end);
end; $$;

-- ---------- 7) 모임 수정·취소 (운영진)
create or replace function public.mcp_update_meetup(
  p_token text, p_slug text, p_event uuid,
  p_title text default null, p_starts_at timestamptz default null,
  p_location text default null, p_description text default null,
  p_members_only boolean default null, p_comments_allowed boolean default null,
  p_cancel boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  r record;
begin
  if v_crew is null then return null; end if;
  update crew_events e
  set title = coalesce(nullif(left(trim(coalesce(p_title, '')), 120), ''), e.title),
      starts_at = coalesce(p_starts_at, e.starts_at),
      location = case when p_location is null then e.location
                      else nullif(left(trim(p_location), 120), '') end,
      description = case when p_description is null then e.description
                         else nullif(left(trim(p_description), 4000), '') end,
      members_only = coalesce(p_members_only, e.members_only),
      comments_allowed = coalesce(p_comments_allowed, e.comments_allowed),
      cancelled_at = case when coalesce(p_cancel, false) then now() else e.cancelled_at end
  where e.id = p_event and e.crew_id = v_crew
  returning e.title, e.starts_at, e.location, e.members_only,
            e.comments_allowed, e.cancelled_at into r;
  if r is null then return jsonb_build_object('error', 'event_not_found'); end if;
  return jsonb_build_object('ok', true, 'title', r.title, 'starts_at', r.starts_at,
    'location', r.location, 'members_only', r.members_only,
    'comments_allowed', r.comments_allowed, 'cancelled', r.cancelled_at is not null);
end; $$;

-- ---------- 8) 모임 참석 체크 (본인 RSVP)
create or replace function public.mcp_rsvp(
  p_token text, p_event uuid, p_status text
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_ok boolean;
begin
  if v_uid is null then return null; end if;
  if p_status not in ('going', 'maybe', 'declined') then
    return jsonb_build_object('error', 'invalid_status');
  end if;
  select true into v_ok from crew_events e
  join crew_members m on m.crew_id = e.crew_id
    and m.user_id = v_uid and m.status = 'active'
  where e.id = p_event and e.cancelled_at is null
    and (not e.members_only or m.role <> 'associate');
  if v_ok is null then return null; end if;

  insert into crew_event_rsvps (event_id, user_id, status)
  values (p_event, v_uid, p_status)
  on conflict (event_id, user_id) do update set status = excluded.status;

  return jsonb_build_object('ok', true, 'status', p_status,
    'going_count', (select count(*) from crew_event_rsvps r
                    where r.event_id = p_event and r.status = 'going'));
end; $$;

-- ---------- 9) 크루 게시판 읽기 (정회원 전용 글 필터)
create or replace function public.mcp_crew_board(
  p_token text, p_slug text, p_limit int default 10, p_category text default null
)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_crew uuid;
  v_full boolean;
begin
  if v_uid is null then return null; end if;
  select c.id into v_crew from crews c
  where c.slug = p_slug and c.status = 'active'
    and (c.is_public or exists (select 1 from crew_members m
      where m.crew_id = c.id and m.user_id = v_uid and m.status = 'active'));
  if v_crew is null then return null; end if;
  v_full := exists (select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = v_uid
      and m.status = 'active' and m.role <> 'associate');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'category', p.category, 'title', p.title,
      'body', left(coalesce(p.body, ''), 1000),
      'author', coalesce(pr.display_name, 'Athlete'),
      'pinned', p.pinned, 'members_only', p.members_only,
      'created_at', p.created_at,
      'comment_count', (select count(*) from crew_post_comments cm
        where cm.post_id = p.id and cm.deleted_at is null))
      order by p.pinned desc, p.created_at desc)
    from (
      select * from crew_posts p0
      where p0.crew_id = v_crew and p0.deleted_at is null
        and (p_category is null or p0.category = p_category)
        and (not p0.members_only or p0.author_id = v_uid or v_full)
      order by p0.pinned desc, p0.created_at desc
      limit least(greatest(coalesce(p_limit, 10), 1), 30)
    ) p
    join profiles pr on pr.id = p.author_id), '[]'::jsonb);
end; $$;

-- ---------- 10) 회비 현황 (본인 + 운영진은 멤버별 매트릭스)
create or replace function public.mcp_dues(
  p_token text, p_slug text, p_month text default null
)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_crew uuid := mcp_member_crew(p_token, p_slug);
  v_staff boolean := mcp_staff_crew(p_token, p_slug) is not null;
  v_month text := coalesce(p_month,
    to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'));
begin
  if v_crew is null then return null; end if;
  if v_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('error', 'invalid_month');
  end if;
  return jsonb_build_object(
    'month', v_month,
    'my_status', coalesce((select d.status from crew_dues_payments d
      where d.crew_id = v_crew and d.user_id = v_uid and d.period = v_month),
      'unpaid'),
    'members', case when v_staff then coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'name', coalesce(pr.display_name, 'Athlete'),
        'role', m.role,
        'status', coalesce(d.status, 'unpaid'),
        'amount', d.amount) order by coalesce(d.status, 'unpaid'), pr.display_name)
      from crew_members m
      join profiles pr on pr.id = m.user_id
      left join crew_dues_payments d on d.crew_id = v_crew
        and d.user_id = m.user_id and d.period = v_month
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb)
      else null end,
    'unpaid_count', case when v_staff then (
      select count(*) from crew_members m
      left join crew_dues_payments d on d.crew_id = v_crew
        and d.user_id = m.user_id and d.period = v_month
      where m.crew_id = v_crew and m.status = 'active'
        and coalesce(d.status, 'unpaid') <> 'confirmed')
      else null end);
end; $$;

-- ---------- 11) 납부 확정 (운영진 — 금액 입력 시 회계 수입 자동 기록)
create or replace function public.mcp_set_dues_paid(
  p_token text, p_slug text, p_user_id uuid, p_month text,
  p_amount int default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
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
    insert into crew_ledger (crew_id, entry_date, kind, amount, title, created_by)
    values (v_crew, current_date, 'income', p_amount,
            p_month || ' 회비 — ' || coalesce(v_name, '멤버'), v_uid);
  end if;

  return jsonb_build_object('ok', true, 'month', p_month, 'amount', p_amount,
    'ledger_recorded', p_amount is not null);
end; $$;

-- ---------- 12) 납부 셀프 신고 (본인 — 확인 대기 상태로)
create or replace function public.mcp_report_dues(
  p_token text, p_slug text, p_month text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_crew uuid := mcp_member_crew(p_token, p_slug);
  v_month text := coalesce(p_month,
    to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'));
  v_status text;
begin
  if v_crew is null then return null; end if;
  if v_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('error', 'invalid_month');
  end if;
  select status into v_status from crew_dues_payments
  where crew_id = v_crew and user_id = v_uid and period = v_month;
  if v_status is not null then
    return jsonb_build_object('ok', true, 'month', v_month, 'status', v_status,
      'already_exists', true);
  end if;
  insert into crew_dues_payments (crew_id, user_id, period, status, reported_at)
  values (v_crew, v_uid, v_month, 'reported', now());
  return jsonb_build_object('ok', true, 'month', v_month, 'status', 'reported');
end; $$;

grant execute on function
  public.mcp_member_crew(text, text),
  public.mcp_my_programs(text),
  public.mcp_program(text, uuid),
  public.mcp_create_program(text, text, int, jsonb, text, text, date, boolean),
  public.mcp_set_program_day(text, uuid, int, text, text),
  public.mcp_attach_crew_program(text, text, uuid, date, date),
  public.mcp_crew_members(text, text),
  public.mcp_update_meetup(text, text, uuid, text, timestamptz, text, text, boolean, boolean, boolean),
  public.mcp_rsvp(text, uuid, text),
  public.mcp_crew_board(text, text, int, text),
  public.mcp_dues(text, text, text),
  public.mcp_set_dues_paid(text, text, uuid, text, int),
  public.mcp_report_dues(text, text, text)
to anon, authenticated;
