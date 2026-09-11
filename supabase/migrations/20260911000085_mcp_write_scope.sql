-- ============================================================
-- Roxlogy — MCP 토큰 읽기/쓰기 범위 (감사 2026-09-11 A03)
--
-- 문제
--   설정 화면은 "읽기 전용"이라고 안내하지만 같은 토큰으로 회계 기록·모임
--   등록·가입 승인·등급 변경·회비·프로그램 생성 같은 쓰기 도구가 전부 됐다.
--   사용자는 조회만 허용한다고 믿고 실제로는 자기 역할의 변경 권한까지
--   외부 AI 클라이언트에 넘기고 있었다.
--
-- 해결
--   profiles.mcp_write (기본 false) — 토큰은 기본 읽기 전용, 사용자가 설정에서
--   켜야 쓰기가 된다. 강제는 DB 가 한다:
--   · 운영진 쓰기 RPC 는 전부 mcp_staff_crew() 로 크루를 얻으므로 그 함수가
--     mcp_write=false 면 null 을 돌려주게 했다(→ 각 RPC 가 "운영진 아님"과
--     같은 경로로 null 반환, 쓰기 없음). 시그니처는 그대로다.
--     운영진 **조회** RPC(대기자·출석·미납·통계·멤버 목록)도 같은 헬퍼를
--     쓰고 있어서 그대로 두면 읽기 전용 토큰의 조회까지 막힌다 — 그것들은
--     새 헬퍼 mcp_staff_crew_ro() 로 옮겼다. 앞으로 운영진 조회 RPC 는 _ro,
--     운영진 쓰기 RPC 는 mcp_staff_crew 를 쓸 것.
--   · 운영진이 아닌 쓰기 RPC(RSVP·회비 신고·프로그램·PFT·운동 요청)는
--     각 함수에서 사용자 확인 직후 mcp_can_write() 로 막고
--     {error:'read_only_token'} 을 돌려준다(시그니처·반환 모양 유지).
--
-- 백필 없음 — 기존 프로필도 전부 읽기 전용에서 시작한다 (검토 라운드에서 결정)
--   mcp_token 은 not null default 라 27개 프로필 전원이 자동 발급 토큰을 갖고
--   있을 뿐, 누가 실제로 클라이언트를 연결했는지는 기록이 없다. "토큰이 있으면
--   true" 백필은 사실상 전원에게 동의 없이 쓰기 범위를 주는 것이라, 화면·서버
--   instructions 가 약속하는 "기본 읽기 전용" 및 감사 권고(분석용 기본 연결은
--   읽기만, 변경은 별도 선택)와 정반대가 된다. 이미 쓰기 도구를 쓰던 사용자는
--   조회는 그대로 되고 쓰기 도구만 {error:'read_only_token', hint:설정 안내}
--   를 받아 설정에서 스위치를 한 번 켜면 된다 — 연결 자체는 끊기지 않는다.
--   (특정 계정만 미리 켜야 하면 적용 전에 1) 아래에 update 한 줄을 추가할 것.)
--
-- 정지 계정(profiles.disabled)
--   mcp_can_write / mcp_write_enabled 는 정지 계정을 읽기 전용/무효 토큰으로
--   보고, mcp_set_write 는 정지 계정에 account_disabled 를 던진다(084 의 재발급과
--   같은 규칙) — 086 의 mcp_uid(`and not disabled`) 없이도 이 파일 혼자 성립한다.
--   mcp_report_dues 는 원래 profiles.mcp_token 을 직접 비교해 사용자를 찾았는데
--   (길이·정지 검사 없음), 재정의하는 김에 mcp_uid(p_token) 으로 통일한다.
--
-- mcp_staff_crew 의 클라이언트 EXECUTE 회수
--   이 함수는 이제 "쓰기 허용 × 운영진" 을 드러내는 내부 게이트다. 007 이 준
--   anon·authenticated EXECUTE 는 create or replace 가 보존하므로 명시적으로
--   회수한다(웹·route·Edge·정책은 직접 부르지 않음 — grep 확인). _ro 와 짝.
--
-- 되돌리기
--   각 함수를 직전 정의로 되돌린 뒤(082·059·063·036·030003·030006·030007·025·007·002)
--   grant execute on function mcp_staff_crew(text,text) to anon, authenticated;  -- 007 상태
--   drop function mcp_can_write(text), mcp_write_enabled(text), mcp_set_write(boolean),
--   mcp_staff_crew_ro(text,text); alter table profiles drop column mcp_write;
-- ============================================================

-- 1) 컬럼 + 백필 ---------------------------------------------------------------
alter table public.profiles
  add column if not exists mcp_write boolean not null default false;

-- 백필 없음(헤더 주석) — 전원 default false = 읽기 전용.

-- 2) 헬퍼 ------------------------------------------------------------------------

-- 내부용: 토큰이 쓰기 허용인가. 무효 토큰·정지 계정은 false. grant 없음(호출자 검증 없는 헬퍼).
create or replace function public.mcp_can_write(p_token text)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select p.mcp_write from profiles p
                    where p.id = mcp_uid(p_token) and not p.disabled), false);
$$;
revoke all on function public.mcp_can_write(text) from public;

-- route 용: 무효 토큰·정지 계정이면 null, 읽기 전용이면 false, 쓰기 허용이면 true.
-- 운영진 쓰기 RPC 의 null 이 "운영진 아님/토큰 무효"인지 "읽기 전용"인지
-- 구분해 사용자가 풀 수 있는 안내를 붙이기 위한 얇은 조회다.
create or replace function public.mcp_write_enabled(p_token text)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select p.mcp_write from profiles p where p.id = mcp_uid(p_token) and not p.disabled;
$$;
revoke all on function public.mcp_write_enabled(text) from public;
grant execute on function public.mcp_write_enabled(text) to anon, authenticated;

-- 설정 화면: 본인 토큰의 쓰기 허용 on/off. 반환은 저장된 값.
create or replace function public.mcp_set_write(p_on boolean)
returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  -- 정지 계정은 JWT 가 아직 살아 있어도 쓰기 범위를 켤 수 없다(084 의 재발급과 같은 규칙)
  update profiles set mcp_write = coalesce(p_on, false) where id = v_uid and not disabled;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    if exists (select 1 from profiles where id = v_uid and disabled) then
      raise exception 'account_disabled';
    end if;
    raise exception 'profile_not_found';
  end if;
  return coalesce(p_on, false);
end;
$$;
revoke all on function public.mcp_set_write(boolean) from public;
grant execute on function public.mcp_set_write(boolean) to authenticated;

-- 3) 운영진 헬퍼 분리 -----------------------------------------------------------

-- 조회용: 토큰 사용자가 운영진인 크루 id (쓰기 허용과 무관). 007 의 원래 본문.
create or replace function public.mcp_staff_crew_ro(p_token text, p_slug text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select c.id from crews c
  join crew_members m on m.crew_id = c.id
    and m.user_id = mcp_uid(p_token)
    and m.status = 'active' and m.role in ('owner', 'coach')
  where c.slug = p_slug and c.status = 'active';
$$;
revoke all on function public.mcp_staff_crew_ro(text, text) from public;

-- 쓰기용: 읽기 전용 토큰이면 null. 운영진 쓰기 RPC 는 모두 이 값이 null 이면
-- 아무것도 하지 않고 null 을 돌려주므로, 여기 한 곳이 전 도구의 게이트다.
create or replace function public.mcp_staff_crew(p_token text, p_slug text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select case when mcp_can_write(p_token)
              then mcp_staff_crew_ro(p_token, p_slug) end;
$$;
-- 내부 게이트가 됐으므로 007 의 클라이언트 EXECUTE 를 회수한다(헤더 주석). 운영진
-- RPC 들은 SECURITY DEFINER 라 소유자 권한으로 부르므로 영향 없다.
revoke execute on function public.mcp_staff_crew(text, text) from public, anon, authenticated;

-- 4) 운영진 조회 RPC → _ro (본문은 현재 DB 정의 그대로, 헬퍼 이름만 교체) ----------

create or replace function public.mcp_pending_members(p_token text, p_slug text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew_ro(p_token, p_slug);
begin
  if v_crew is null then return null; end if;  -- 운영진이 아니면 '대기자 없음'이 아니다
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', p.display_name,
        'requested_at', m.joined_at) order by m.joined_at)
    from crew_members m
    join profiles p on p.id = m.user_id
    where m.crew_id = v_crew and m.status = 'pending'), '[]'::jsonb);
end; $$;

create or replace function public.mcp_crew_members(p_token text, p_slug text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_member_crew(p_token, p_slug);
  v_staff boolean := mcp_staff_crew_ro(p_token, p_slug) is not null;
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

create or replace function public.mcp_event_attendance(p_token text, p_slug text, p_event uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew_ro(p_token, p_slug); v_ev record;
begin
  if v_crew is null then return null; end if;
  select id, title, starts_at, fee_exempt, members_only, closed_at
    into v_ev from crew_events
   where id = p_event and crew_id = v_crew and cancelled_at is null;
  if v_ev.id is null then return jsonb_build_object('error', 'event_not_found'); end if;

  return jsonb_build_object(
    'event_id', v_ev.id, 'title', v_ev.title, 'starts_at', v_ev.starts_at,
    'fee_exempt', v_ev.fee_exempt, 'members_only', v_ev.members_only,
    'closed', v_ev.closed_at is not null,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', coalesce(p.display_name, 'Athlete'),
        'tier', t.name, 'rsvp', r.status,
        'checked_in', r.checked_in_at is not null,
        'charge_id', ch.id, 'fee', ch.amount, 'fee_status', ch.status)
        order by (r.checked_in_at is null), coalesce(p.display_name, 'Athlete'))
      from crew_members m
      join profiles p on p.id = m.user_id
      left join crew_member_tiers t on t.id = m.tier_id
      left join crew_event_rsvps r on r.event_id = p_event and r.user_id = m.user_id
      left join crew_dues_charges ch on ch.event_id = p_event and ch.user_id = m.user_id
                                    and ch.kind = 'session'
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb));
end;
$$;

create or replace function public.mcp_crew_unpaid(p_token text, p_slug text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew_ro(p_token, p_slug);
begin
  if v_crew is null then return null; end if;
  return jsonb_build_object(
    'unpaid_amount', coalesce((select sum(amount) from crew_dues_charges
                                where crew_id = v_crew and status in ('pending','reported')), 0),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'charge_id', ch.id, 'user_id', ch.user_id,
        'name', coalesce(p.display_name, 'Athlete'),
        'period', ch.period, 'kind', ch.kind, 'label', ch.label,
        'amount', ch.amount, 'status', ch.status)
        order by coalesce(p.display_name, 'Athlete'), ch.period desc)
      from crew_dues_charges ch join profiles p on p.id = ch.user_id
      where ch.crew_id = v_crew and ch.status in ('pending','reported')), '[]'::jsonb));
end;
$$;

create or replace function public.mcp_crew_stats(p_token text, p_slug text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew_ro(p_token, p_slug);
begin
  if v_crew is null then return null; end if;
  return jsonb_build_object(
    'members', (select count(*) from crew_members
                 where crew_id = v_crew and status = 'active'),
    'pending', (select count(*) from crew_members
                 where crew_id = v_crew and status = 'pending'),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object('tier', t.name,
        'count', (select count(*) from crew_members m
                   where m.tier_id = t.id and m.status = 'active'))
        order by t.sort_order)
      from crew_member_tiers t
      where t.crew_id = v_crew and t.archived_at is null), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', coalesce(p.display_name, 'Athlete'),
        'paid', (select count(*) from crew_event_rsvps r
                   join crew_events e on e.id = r.event_id
                  where r.user_id = m.user_id and e.crew_id = v_crew
                    and e.cancelled_at is null and not e.fee_exempt
                    and r.checked_in_at is not null),
        'total', (select count(*) from crew_event_rsvps r
                    join crew_events e on e.id = r.event_id
                   where r.user_id = m.user_id and e.crew_id = v_crew
                     and e.cancelled_at is null and r.checked_in_at is not null))
        order by coalesce(p.display_name, 'Athlete'))
      from crew_members m join profiles p on p.id = m.user_id
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb),
    'unpaid_amount', coalesce((select sum(amount) from crew_dues_charges
                                where crew_id = v_crew and status in ('pending','reported')), 0),
    'waived_amount', coalesce((select sum(amount) from crew_dues_charges
                                where crew_id = v_crew and status = 'waived'), 0));
end;
$$;

-- 5) 운영진 아닌 쓰기 RPC — 사용자 확인 직후 게이트 (본문은 현재 DB 정의 그대로) ------

create or replace function public.mcp_rsvp(p_token text, p_event uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_ok boolean;
  v_stored text;
  v_pos int;
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
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

  select status into v_stored from crew_event_rsvps
  where event_id = p_event and user_id = v_uid;
  if v_stored = 'waitlisted' then
    select count(*) into v_pos from crew_event_rsvps r
    where r.event_id = p_event and r.status = 'waitlisted'
      and (r.queued_at, r.created_at) <= (
        select r2.queued_at, r2.created_at from crew_event_rsvps r2
        where r2.event_id = p_event and r2.user_id = v_uid);
  end if;

  return jsonb_build_object('ok', true, 'status', v_stored,
    'waitlist_position', v_pos,
    'going_count', (select count(*) from crew_event_rsvps r
                    where r.event_id = p_event and r.status = 'going'),
    'capacity', (select capacity from crew_events where id = p_event));
end;
$$;

create or replace function public.mcp_report_dues(p_token text, p_slug text, p_month text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_crew uuid; v_period text; n int;
begin
  -- 원래는 profiles.mcp_token 직접 비교였다(길이·정지 검사 없음). 다른 mcp_* 와 같은 관문으로.
  v_uid := mcp_uid(p_token);
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
  select c.id into v_crew from crews c
   join crew_members m on m.crew_id = c.id and m.user_id = v_uid and m.status = 'active'
   where c.slug = p_slug;
  if v_crew is null then return null; end if;
  v_period := coalesce(p_month, to_char(app_today(), 'YYYY-MM'));

  update crew_dues_charges
     set status = 'reported', reported_at = now()
   where crew_id = v_crew and user_id = v_uid and period = v_period and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'period', v_period, 'reported', n);
end;
$$;

create or replace function public.mcp_request_exercise(
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
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
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

create or replace function public.mcp_add_pft(
  p_token text, p_total_ms integer, p_tested_on date default null,
  p_run_ms integer default null, p_burpee_ms integer default null,
  p_lunge_ms integer default null, p_row_ms integer default null,
  p_pushup_ms integer default null, p_wallball_ms integer default null,
  p_scaled boolean default false, p_location text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token); v_id uuid; v_age int; v_gender text;
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
  if p_total_ms is null or p_total_ms < 300000 or p_total_ms > 10800000 then
    return jsonb_build_object('error', 'bad_total_ms');
  end if;
  select case when birth_year is null then null
              else extract(year from app_today())::int - birth_year end,
         case when gender in ('male','female','other') then gender end
    into v_age, v_gender from profiles where id = v_uid;

  insert into pft_results
    (user_id, tested_on, total_ms, run_ms, burpee_ms, lunge_ms, row_ms,
     pushup_ms, wallball_ms, age, gender, scaled, location)
  values (v_uid, coalesce(p_tested_on, app_today()), p_total_ms,
          p_run_ms, p_burpee_ms, p_lunge_ms, p_row_ms, p_pushup_ms, p_wallball_ms,
          v_age, v_gender, coalesce(p_scaled, false),
          nullif(btrim(coalesce(p_location, '')), ''))
  returning id into v_id;

  return (select jsonb_build_object('ok', true, 'id', f.id, 'total_ms', f.total_ms,
            'badge', f.badge, 'tested_on', f.tested_on)
          from pft_results f where f.id = v_id);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

create or replace function public.mcp_create_program(
  p_token text, p_title text, p_weeks integer, p_days jsonb,
  p_level text default 'intermediate', p_description text default null,
  p_week_pattern integer[] default null
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
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
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

create or replace function public.mcp_set_program_day(
  p_token text, p_program uuid, p_day_index integer,
  p_focus text default null, p_notes text default null, p_workouts jsonb default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_weeks int;
  v_day_id uuid;
  v_err jsonb;
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
  select weeks into v_weeks from programs
  where id = p_program and owner_id = v_uid;
  if v_weeks is null then return null; end if;
  if p_day_index is null or p_day_index < 1 or p_day_index > v_weeks * 7 then
    return jsonb_build_object('error', 'invalid_day_index');
  end if;

  if p_focus is null and p_notes is null and p_workouts is null then
    delete from program_days where program_id = p_program and day_index = p_day_index;
    return jsonb_build_object('ok', true, 'day_index', p_day_index, 'deleted', true);
  end if;

  select id into v_day_id from program_days
  where program_id = p_program and day_index = p_day_index;
  if v_day_id is null then
    insert into program_days (program_id, day_index, focus, notes)
    values (p_program, p_day_index,
            nullif(left(trim(coalesce(p_focus, '')), 200), ''),
            nullif(left(trim(coalesce(p_notes, '')), 2000), ''))
    returning id into v_day_id;
  else
    update program_days
    set focus = case when p_focus is null then focus
                     else nullif(left(trim(p_focus), 200), '') end,
        notes = case when p_notes is null then notes
                     else nullif(left(trim(p_notes), 2000), '') end
    where id = v_day_id;
  end if;

  if p_workouts is not null then
    -- 교체: 기존 워크아웃 삭제 후 재생성 (검증 실패 시 예외 → 블록 전체 롤백)
    delete from workout_templates where program_day_id = v_day_id;
    v_err := _mcp_insert_workouts(v_day_id, p_workouts);
    if v_err is not null then
      raise exception 'MCP_WORKOUT_ERR %', v_err::text using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'day_index', p_day_index,
    'workouts', case when p_workouts is null then null
                     else jsonb_array_length(p_workouts) end);
exception
  when others then
    if sqlerrm like 'MCP_WORKOUT_ERR %' then
      return substring(sqlerrm from 17)::jsonb;
    end if;
    raise;
end; $$;

create or replace function public.mcp_update_program(
  p_token text, p_program uuid, p_title text default null,
  p_description text default null, p_weeks integer default null,
  p_level text default null, p_is_public boolean default null,
  p_week_pattern integer[] default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token); v_pat smallint[];
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then
    return jsonb_build_object('error', 'read_only_token');
  end if;
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

-- language sql 두 개는 CASE 로 게이트한다 — CASE 는 필요한 가지만 평가하므로
-- 읽기 전용이면 rox_*_program 이 호출되지 않는다. 무효 토큰(uid null)은
-- 예전과 같은 경로로 흘려 응답 모양을 바꾸지 않는다.
create or replace function public.mcp_start_program(
  p_token text, p_program uuid, p_start_date date default null,
  p_repeat boolean default false, p_end_date date default null
)
returns jsonb
language sql security definer set search_path to 'public' as $$
  select case
    when mcp_uid(p_token) is not null and not mcp_can_write(p_token)
      then jsonb_build_object('error', 'read_only_token')
    else public.rox_start_program(
      mcp_uid(p_token), p_program, coalesce(p_start_date, app_today()),
      p_repeat, p_end_date)
  end;
$$;

create or replace function public.mcp_stop_program(p_token text, p_program uuid default null)
returns jsonb
language sql security definer set search_path to 'public' as $$
  select case
    when mcp_uid(p_token) is not null and not mcp_can_write(p_token)
      then jsonb_build_object('error', 'read_only_token')
    else public.rox_stop_program(mcp_uid(p_token), p_program)
  end;
$$;

-- 가드 ----------------------------------------------------------------------------
do $$
declare
  v_uid uuid; v_tok text; v_slug text; v_fn text; j jsonb;
begin
  -- (0) 기본값: 프로필은 읽기 전용으로 시작한다 (백필 없음 — 헤더 주석)
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles'
                    and column_name = 'mcp_write' and is_nullable = 'NO'
                    and column_default = 'false') then
    raise exception '가드: profiles.mcp_write 가 not null default false 가 아닙니다';
  end if;

  -- (0b) 내부 헬퍼·게이트에 클라이언트 EXECUTE 가 없어야 한다
  if has_function_privilege('anon', 'public.mcp_staff_crew(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.mcp_staff_crew(text,text)', 'execute')
     or has_function_privilege('anon', 'public.mcp_staff_crew_ro(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.mcp_staff_crew_ro(text,text)', 'execute')
     or has_function_privilege('anon', 'public.mcp_can_write(text)', 'execute')
     or has_function_privilege('authenticated', 'public.mcp_can_write(text)', 'execute') then
    raise exception '가드: mcp_staff_crew / _ro / mcp_can_write 에 클라이언트 EXECUTE 가 남아 있습니다';
  end if;

  -- (1) 쓰기 RPC 전수: 본문에 게이트(mcp_can_write 또는 mcp_staff_crew)가 있어야 한다
  foreach v_fn in array array[
    'mcp_add_ledger','mcp_add_meetup','mcp_post_notice','mcp_approve_member',
    'mcp_settle_ledger','mcp_set_bank_opening','mcp_close_month','mcp_attach_crew_program',
    'mcp_update_meetup','mcp_set_dues_paid','mcp_check_in','mcp_set_meetup_flags',
    'mcp_set_member_tier','mcp_sync_dues','mcp_waive_dues',
    'mcp_request_exercise','mcp_create_program','mcp_set_program_day','mcp_update_program',
    'mcp_start_program','mcp_stop_program','mcp_rsvp','mcp_report_dues','mcp_add_pft'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
        and (p.prosrc like '%mcp_can_write(%' or p.prosrc like '%mcp_staff_crew(p_token%')
    ) then
      raise exception '가드: 쓰기 RPC % 에 읽기 전용 게이트가 없습니다', v_fn;
    end if;
  end loop;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'mcp_staff_crew'
                    and p.prosrc like '%mcp_can_write(%') then
    raise exception '가드: mcp_staff_crew 가 쓰기 허용을 보지 않습니다';
  end if;

  -- (2) 동작: 활성 운영진 토큰이 있으면 그걸로, 없으면 아무 활성 토큰으로
  --     (086 의 mcp_uid 는 정지 계정에 null 을 주므로 정지 프로필은 고르지 않는다)
  select p.id, p.mcp_token, c.slug into v_uid, v_tok, v_slug
    from public.profiles p
    join public.crew_members m on m.user_id = p.id and m.status = 'active'
                              and m.role in ('owner', 'coach')
    join public.crews c on c.id = m.crew_id and c.status = 'active'
   where p.mcp_token is not null and not p.disabled limit 1;
  if v_uid is null then
    select id, mcp_token into v_uid, v_tok from public.profiles
     where mcp_token is not null and not disabled limit 1;
  end if;
  if v_uid is null then return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  perform public.mcp_set_write(false);
  if public.mcp_can_write(v_tok) then
    raise exception '가드: 읽기 전용으로 바꿨는데 mcp_can_write 가 true 입니다';
  end if;
  if public.mcp_write_enabled(v_tok) is distinct from false then
    raise exception '가드: mcp_write_enabled 가 읽기 전용 토큰에 false 를 주지 않습니다';
  end if;
  if public.mcp_write_enabled('guard-token-that-does-not-exist-0000') is not null then
    raise exception '가드: mcp_write_enabled 가 무효 토큰에 null 을 주지 않습니다';
  end if;

  -- 운영진 아닌 쓰기 RPC 전부 거부 (게이트가 DML 앞이라 데이터는 안 바뀐다)
  j := public.mcp_rsvp(v_tok, gen_random_uuid(), 'going');
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_rsvp 가 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_report_dues(v_tok, 'guard-no-such-crew');
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_report_dues 가 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_request_exercise(v_tok, 'guard');
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_request_exercise 가 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_add_pft(v_tok, 600000);
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_add_pft 가 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_create_program(v_tok, 'guard', 1, '[]'::jsonb);
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_create_program 이 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_set_program_day(v_tok, gen_random_uuid(), 1);
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_set_program_day 가 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_update_program(v_tok, gen_random_uuid());
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_update_program 이 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_start_program(v_tok, gen_random_uuid());
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_start_program 이 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;
  j := public.mcp_stop_program(v_tok);
  if j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: mcp_stop_program 이 읽기 전용 토큰을 거부하지 않습니다 (%)', j; end if;

  -- 운영진: 쓰기 헬퍼는 null, 조회 헬퍼·조회 RPC 는 그대로, 쓰기 RPC 는 null
  if v_slug is not null then
    if public.mcp_staff_crew(v_tok, v_slug) is not null then
      raise exception '가드: 읽기 전용 토큰에 mcp_staff_crew 가 크루를 돌려줍니다'; end if;
    if public.mcp_staff_crew_ro(v_tok, v_slug) is null then
      raise exception '가드: mcp_staff_crew_ro 가 운영진을 못 찾습니다'; end if;
    if public.mcp_pending_members(v_tok, v_slug) is null
       or public.mcp_crew_stats(v_tok, v_slug) is null
       or public.mcp_crew_unpaid(v_tok, v_slug) is null then
      raise exception '가드: 읽기 전용 토큰으로 운영진 조회가 막혔습니다'; end if;
    if public.mcp_add_ledger(v_tok, v_slug, 'expense', 1, 'guard') is not null then
      raise exception '가드: 읽기 전용 토큰으로 회계 기록이 됩니다'; end if;
  end if;

  -- 다시 켜면 통과
  perform public.mcp_set_write(true);
  if not public.mcp_can_write(v_tok) or public.mcp_write_enabled(v_tok) is not true then
    raise exception '가드: 쓰기 허용을 켰는데 mcp_can_write 가 false 입니다'; end if;
  if v_slug is not null and public.mcp_staff_crew(v_tok, v_slug) is null then
    raise exception '가드: 쓰기 허용 토큰에 mcp_staff_crew 가 null 입니다'; end if;

  -- (3) 정지 계정: 살아 있는 JWT 로도 쓰기 범위를 켤 수 없고, 헬퍼는 읽기 전용/무효로 본다.
  --     disabled 변경은 privileged_guard 가 비관리자 JWT 에 막으므로 JWT 를 비운 채(신뢰 경계) 바꾼다.
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set disabled = true where id = v_uid;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  begin
    perform public.mcp_set_write(true);
    raise exception '가드: 정지 계정이 변경 허용을 켭니다';
  exception when others then
    if sqlerrm not like '%account_disabled%' then raise; end if;
  end;
  if public.mcp_can_write(v_tok) then
    raise exception '가드: 정지 계정 토큰에 mcp_can_write 가 true 입니다'; end if;
  if public.mcp_write_enabled(v_tok) is not null then
    raise exception '가드: 정지 계정 토큰에 mcp_write_enabled 가 null 이 아닙니다'; end if;
  if v_slug is not null and public.mcp_staff_crew(v_tok, v_slug) is not null then
    raise exception '가드: 정지 계정 토큰에 mcp_staff_crew 가 크루를 돌려줍니다'; end if;
  -- mcp_report_dues: 086 이전(원래 mcp_uid)엔 read_only_token, 086 이후엔 null — 어느 쪽이든 쓰기는 거부
  j := public.mcp_report_dues(v_tok, 'guard-no-such-crew');
  if j is not null and j->>'error' is distinct from 'read_only_token' then
    raise exception '가드: 정지 계정 토큰으로 mcp_report_dues 가 쓰기를 진행합니다 (%)', j; end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
