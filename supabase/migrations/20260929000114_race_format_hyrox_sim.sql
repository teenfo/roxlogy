-- ============================================================
-- Roxlogy — 레이스 계측을 하이록스 시뮬레이션으로 확장
--
-- PFT 레이스(코드·웨이브·DNF·스태프 계측·라이브보드)를 그대로 두고, 레이스를
-- 만들 때 종목을 고르게 한다.
--   format = 'pft'        → 구간 6, 완주하면 pft_results (지금 그대로)
--   format = 'hyrox_sim'  → 구간 16/24/32 (체크포인트 모드), 완주하면 선수 본인의
--                           sessions + session_segments 를 만든다
--
-- 체크포인트 모드 (8 랩 반복):
--   16 = run, station                    — 록스존은 다음 런에 포함
--   24 = run, roxzone, station           — 웹 수동 입력·가민과 같은 구조
--   32 = run, roxzone, station, roxzone  — Wear OS 레코더와 같은 구조
--
-- 모두 덧붙이기다(컬럼 추가·응답 키 추가·기본값 있는 인자 추가) — 옛 번들은 새 키를
-- 무시하고 지나간다. 테이블·라우트 이름은 바꾸지 않는다.
--
-- 되돌리기: 아래 함수들을 093·094·095·101 정의로 되돌리고
--   alter table pft_race_entries drop column session_id;
--   alter table pft_races drop column checkpoints, drop column format;
-- ============================================================

-- ---------- 컬럼 ----------------------------------------------------------------
alter table public.pft_races
  add column if not exists format text not null default 'pft',
  add column if not exists checkpoints smallint not null default 6;

alter table public.pft_races drop constraint if exists pft_races_format_check;
alter table public.pft_races add constraint pft_races_format_check
  check ((format = 'pft' and checkpoints = 6)
      or (format = 'hyrox_sim' and checkpoints in (16, 24, 32)));

comment on column public.pft_races.format is
  '레이스 종목. pft = PFT 6구간(pft_results), hyrox_sim = 하이록스 시뮬(선수 세션 생성)';
comment on column public.pft_races.checkpoints is
  '선수당 찍는 구간 수. pft 는 6, hyrox_sim 은 16/24/32 (web/lib/race-format.ts 와 같아야 한다)';

alter table public.pft_race_entries
  add column if not exists session_id uuid references public.sessions(id) on delete set null;

comment on column public.pft_race_entries.session_id is
  'hyrox_sim 완주 시 만든 선수 본인의 세션. 완주 취소·제거 시 세션은 soft delete';

-- ---------- 내부: 완주한 시뮬을 선수 세션으로 -----------------------------------
-- 호출자 검증이 없는 SECURITY DEFINER 헬퍼 — 절대 grant 하지 않는다 (CLAUDE.md).
-- 운동 id·machine_type 은 web/lib/hyrox.ts STATIONS 와 시드 01 과 같아야 한다:
--   run = e0000000-…-09, station i = e0000000-…-0i, ski(1)·row(5)만 machine_type.
create or replace function public._race_sim_session(p_entry uuid, p_splits integer[], p_checkpoints integer)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  rec record; v_sid uuid := gen_random_uuid();
  v_pattern text[]; v_per int; i int; v_lap int; v_kind text;
  v_prev int := 0; v_cur int; v_ex uuid; v_machine text; v_div text;
begin
  select e.user_id, e.started_at, r.title into rec
    from pft_race_entries e join pft_races r on r.id = e.race_id where e.id = p_entry;
  if rec.user_id is null or rec.started_at is null then return null; end if;
  if cardinality(p_splits) <> p_checkpoints then return null; end if;

  v_pattern := case p_checkpoints
    when 16 then array['run','station']
    when 24 then array['run','roxzone','station']
    when 32 then array['run','roxzone','station','roxzone']
  end;
  if v_pattern is null then return null; end if;
  v_per := cardinality(v_pattern);

  select division into v_div from profiles where id = rec.user_id;

  insert into sessions (id, user_id, source_device, analysis_status, started_at, ended_at,
                        total_time_ms, client_updated_at, division, notes)
  values (v_sid, rec.user_id, 'web', 'pending', rec.started_at,
          rec.started_at + make_interval(secs => p_splits[p_checkpoints] / 1000.0),
          p_splits[p_checkpoints], now(), v_div, left(rec.title, 200));

  for i in 1..p_checkpoints loop
    v_lap := ((i - 1) / v_per) + 1;             -- 1..8
    v_kind := v_pattern[((i - 1) % v_per) + 1];
    v_cur := p_splits[i];
    v_ex := case v_kind
      when 'run' then 'e0000000-0000-0000-0000-000000000009'::uuid
      when 'station' then ('e0000000-0000-0000-0000-00000000000' || v_lap)::uuid
      else null end;
    v_machine := case when v_kind = 'station' and v_lap = 1 then 'ski'
                      when v_kind = 'station' and v_lap = 5 then 'row' end;
    insert into session_segments (session_id, seq, kind, exercise_id, machine_type,
                                  split_time_ms, started_at, ended_at)
    values (v_sid, i, v_kind, v_ex, v_machine, v_cur - v_prev,
            rec.started_at + make_interval(secs => v_prev / 1000.0),
            rec.started_at + make_interval(secs => v_cur / 1000.0));
    v_prev := v_cur;
  end loop;

  return v_sid;
end; $$;
revoke all on function public._race_sim_session(uuid, integer[], integer) from public, anon, authenticated;

-- ---------- 엔트리 응답에 session_id ---------------------------------------------
create or replace function public._pft_entry_json(p_entry uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'entry_id', e.id, 'race_id', e.race_id, 'started_at', e.started_at,
    'splits', to_jsonb(e.splits), 'finished_at', e.finished_at, 'total_ms', e.total_ms,
    'scaled', e.scaled, 'result_id', e.result_id, 'dnf_at', e.dnf_at, 'status', r.status,
    'session_id', e.session_id)
  from pft_race_entries e join pft_races r on r.id = e.race_id where e.id = p_entry;
$$;
revoke all on function public._pft_entry_json(uuid) from public, anon, authenticated;

-- ---------- 구간 기록: 종목별 구간 수·완주 처리 -----------------------------------
create or replace function public._pft_apply_split(p_entry uuid, p_elapsed_ms integer)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  rec record; v_n int; v_prev int; v_max int; v_cap int;
  v_age int; v_gender text; v_res uuid; v_sess uuid; v_cols int[];
begin
  select en.*, r.status as race_status, r.title as race_title,
         r.format as race_format, r.checkpoints as race_checkpoints
    into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.id = p_entry for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.started_at is null then return jsonb_build_object('error', 'not_started'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished'); end if;
  v_max := rec.race_checkpoints;
  -- 경과 상한: PFT 3시간, 하이록스 시뮬 4시간
  v_cap := case when rec.race_format = 'hyrox_sim' then 14400000 else 10800000 end;
  v_n := cardinality(rec.splits);
  if v_n >= v_max then return jsonb_build_object('error', 'already_finished'); end if;
  v_prev := case when v_n = 0 then 0 else rec.splits[v_n] end;
  if p_elapsed_ms is null or p_elapsed_ms <= v_prev or p_elapsed_ms > v_cap then
    return jsonb_build_object('error', 'invalid_elapsed', 'last', v_prev);
  end if;
  update pft_race_entries set splits = splits || p_elapsed_ms, updated_at = now() where id = rec.id;
  v_n := v_n + 1;
  v_cols := rec.splits || p_elapsed_ms;

  if v_n = v_max then
    if rec.race_format = 'hyrox_sim' then
      -- 30분 미만은 시뮬로 보기 어렵다(리더보드 하한과 같다) — 완주만 남기고 세션은 만들지 않는다
      if p_elapsed_ms >= 1800000 then
        v_sess := _race_sim_session(rec.id, v_cols, v_max);
      end if;
      update pft_race_entries set finished_at = now(), total_ms = p_elapsed_ms, session_id = v_sess,
             updated_at = now() where id = rec.id;
    else
      select case when birth_year is null then null
                  else extract(year from app_today())::int - birth_year end,
             case when gender in ('male','female','other') then gender end
        into v_age, v_gender from profiles where id = rec.user_id;
      if p_elapsed_ms >= 300000 then
        insert into pft_results
          (user_id, tested_on, total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms,
           age, gender, scaled, location, shared)
        values (rec.user_id, app_today(), p_elapsed_ms,
                v_cols[1], v_cols[2]-v_cols[1], v_cols[3]-v_cols[2], v_cols[4]-v_cols[3],
                v_cols[5]-v_cols[4], v_cols[6]-v_cols[5],
                v_age, v_gender, rec.scaled, left(rec.race_title, 80), true)
        returning id into v_res;
      end if;
      update pft_race_entries set finished_at = now(), total_ms = p_elapsed_ms, result_id = v_res,
             updated_at = now() where id = rec.id;
    end if;
  end if;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public._pft_apply_split(uuid, integer) from public, anon, authenticated;

-- ---------- 되돌리기: 완주 취소 시 세션도 soft delete ------------------------------
create or replace function public._pft_apply_undo(p_entry uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare rec record; v_n int;
begin
  select en.*, r.status as race_status into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.id = p_entry for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  v_n := cardinality(rec.splits);
  if v_n = 0 then return jsonb_build_object('error', 'nothing_to_undo'); end if;
  if rec.finished_at is not null then
    if rec.result_id is not null then
      update pft_results set deleted_at = now() where id = rec.result_id and deleted_at is null;
    end if;
    if rec.session_id is not null then
      update sessions set deleted_at = now(), client_updated_at = now()
       where id = rec.session_id and deleted_at is null;
    end if;
    update pft_race_entries set finished_at = null, total_ms = null, result_id = null, session_id = null
     where id = rec.id;
  end if;
  update pft_race_entries set splits = splits[1:v_n-1], updated_at = now() where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public._pft_apply_undo(uuid) from public, anon, authenticated;

-- ---------- 제거: 연결된 세션도 soft delete --------------------------------------
create or replace function public.pft_race_staff_remove(p_race uuid, p_entry uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_res uuid; v_sess uuid;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if exists (select 1 from pft_races where id = p_race and status = 'closed') then
    return jsonb_build_object('error', 'race_closed');
  end if;
  select result_id, session_id into v_res, v_sess from pft_race_entries where id = p_entry and race_id = p_race;
  if not found then return jsonb_build_object('error', 'not_joined'); end if;
  if v_res is not null then
    update pft_results set deleted_at = now() where id = v_res and deleted_at is null;
  end if;
  if v_sess is not null then
    update sessions set deleted_at = now(), client_updated_at = now()
     where id = v_sess and deleted_at is null;
  end if;
  delete from pft_race_entries where id = p_entry;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.pft_race_staff_remove(uuid, uuid) from public;
grant execute on function public.pft_race_staff_remove(uuid, uuid) to authenticated;

-- ---------- 생성: 종목·체크포인트 모드 --------------------------------------------
-- 인자가 늘어나므로 drop + create. 새 인자에 기본값이 있어 옛 번들의 3인자 호출도 그대로 붙는다.
drop function if exists public.pft_race_create(text, text, boolean);
create function public.pft_race_create(
  p_title text,
  p_crew_slug text default null,
  p_join_open boolean default true,
  p_format text default 'pft',
  p_checkpoints integer default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_crew uuid; v_code text; v_id uuid; i int;
  v_title text := trim(coalesce(p_title, ''));
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_open boolean := coalesce(p_join_open, true);
  v_format text := coalesce(nullif(p_format, ''), 'pft');
  v_cp int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    return jsonb_build_object('error', 'invalid_title');
  end if;
  if v_format = 'pft' then
    v_cp := 6;
  elsif v_format = 'hyrox_sim' then
    v_cp := coalesce(p_checkpoints, 16);
    if v_cp not in (16, 24, 32) then return jsonb_build_object('error', 'invalid_checkpoints'); end if;
  else
    return jsonb_build_object('error', 'invalid_format');
  end if;
  if p_crew_slug is not null and p_crew_slug <> '' then
    select id into v_crew from crews where slug = p_crew_slug and status = 'active';
    if v_crew is null then return jsonb_build_object('error', 'crew_not_found'); end if;
    if not (is_admin() or is_crew_staff(v_crew)) then
      return jsonb_build_object('error', 'not_allowed');
    end if;
  elsif not is_admin() then
    return jsonb_build_object('error', 'not_allowed',
      'hint', '전체 관리자이거나, 크루 운영진이면 crew_slug 를 지정하세요.');
  end if;
  -- 6자리 코드 — 헷갈리는 글자(0/O, 1/I) 제외. 충돌하면 다시 뽑는다.
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from pft_races where code = v_code);
  end loop;
  insert into pft_races (code, title, crew_id, created_by, join_open, format, checkpoints)
  values (v_code, v_title, v_crew, v_uid, v_open, v_format, v_cp) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'join_open', v_open,
                            'format', v_format, 'checkpoints', v_cp);
end; $$;
revoke all on function public.pft_race_create(text, text, boolean, text, integer) from public;
grant execute on function public.pft_race_create(text, text, boolean, text, integer) to authenticated;

-- ---------- 보드: race 에 format·checkpoints, 엔트리에 session_id ------------------
create or replace function public.pft_race_board(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'code', r.code, 'title', r.title, 'status', r.status,
                               'crew', c.name, 'crew_slug', c.slug, 'created_at', r.created_at,
                               'join_open', r.join_open,
                               'format', r.format, 'checkpoints', r.checkpoints),
    'server_now', now(),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', e.id, 'user_id', e.user_id,
        'name', coalesce(nullif(p.display_name, ''), 'Athlete'),
        'started_at', e.started_at, 'splits', to_jsonb(e.splits),
        'finished_at', e.finished_at, 'total_ms', e.total_ms, 'scaled', e.scaled,
        'wave', e.wave, 'dnf_at', e.dnf_at,
        'badge', res.badge) order by e.joined_at)
      from pft_race_entries e
      join profiles p on p.id = e.user_id
      left join pft_results res on res.id = e.result_id
      where e.race_id = r.id), '[]'::jsonb))
  from pft_races r left join crews c on c.id = r.crew_id
  where r.code = upper(trim(coalesce(p_code, '')));
$$;
grant execute on function public.pft_race_board(text) to anon, authenticated;

-- ---------- 목록: format·checkpoints -------------------------------------------
create or replace function public.pft_race_joinable()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'code', s.code, 'title', s.title, 'created_at', s.created_at,
             'crew', s.crew, 'crew_slug', s.crew_slug,
             'entries', s.entries, 'joined', s.joined,
             'format', s.format, 'checkpoints', s.checkpoints)
           order by s.joined, s.created_at desc)
    from (
      select r.id, r.code, r.title, r.created_at, c.name as crew, c.slug as crew_slug,
             r.format, r.checkpoints,
             (select count(*) from pft_race_entries e where e.race_id = r.id) as entries,
             exists (select 1 from pft_race_entries e where e.race_id = r.id and e.user_id = v_uid) as joined
      from pft_races r left join crews c on c.id = r.crew_id
      where r.status = 'open' and r.join_open
        and (r.crew_id is null
             or exists (select 1 from crew_members m
                         where m.crew_id = r.crew_id and m.user_id = v_uid and m.status = 'active'))
      order by r.created_at desc
      limit 50) s), '[]'::jsonb);
end; $$;
revoke all on function public.pft_race_joinable() from public;
grant execute on function public.pft_race_joinable() to authenticated;

create or replace function public.pft_race_admin_list()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not is_admin() then return jsonb_build_object('error', 'not_allowed'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'code', s.code, 'title', s.title, 'status', s.status,
             'join_open', s.join_open, 'created_at', s.created_at, 'closed_at', s.closed_at,
             'crew', s.crew, 'created_by', s.created_by,
             'entries', s.entries, 'finished', s.finished,
             'format', s.format, 'checkpoints', s.checkpoints)
           order by s.created_at desc)
    from (
      select r.id, r.code, r.title, r.status, r.join_open, r.created_at, r.closed_at,
             r.format, r.checkpoints,
             c.name as crew,
             coalesce(nullif(p.display_name, ''), 'Athlete') as created_by,
             (select count(*) from pft_race_entries e where e.race_id = r.id) as entries,
             (select count(*) from pft_race_entries e
               where e.race_id = r.id and e.finished_at is not null) as finished
      from pft_races r
      left join crews c on c.id = r.crew_id
      left join profiles p on p.id = r.created_by
      order by r.created_at desc
      limit 300) s), '[]'::jsonb);
end; $$;
revoke all on function public.pft_race_admin_list() from public;
grant execute on function public.pft_race_admin_list() to authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 실제로 레이스를 만들어 구간을 넣어 보고, 끝나면 예외로 되감는다(운영 데이터 무변경).
do $$
declare
  v_user uuid; v_race uuid; v_entry uuid; j jsonb; v_sess uuid; n int; s bigint; v_total int;
  v_mode int; i int; v_splits int[];
begin
  -- 헬퍼는 누구에게도 열려 있으면 안 된다
  if has_function_privilege('anon', 'public._race_sim_session(uuid, integer[], integer)', 'execute')
     or has_function_privilege('authenticated', 'public._race_sim_session(uuid, integer[], integer)', 'execute') then
    raise exception '가드: _race_sim_session 이 클라이언트에 열려 있습니다';
  end if;
  if not has_function_privilege('authenticated', 'public.pft_race_create(text, text, boolean, text, integer)', 'execute') then
    raise exception '가드: pft_race_create 에 authenticated execute 가 없습니다';
  end if;

  select id into v_user from profiles order by created_at limit 1;
  if v_user is null then raise notice '가드 건너뜀: 프로필 없음'; return; end if;

  begin
    foreach v_mode in array array[16, 24, 32] loop
      insert into pft_races (code, title, created_by, format, checkpoints)
      values (case v_mode when 16 then 'ZZGAAA' when 24 then 'ZZGBBB' else 'ZZGCCC' end,
              '가드 시뮬 ' || v_mode, v_user, 'hyrox_sim', v_mode)
      returning id into v_race;
      insert into pft_race_entries (race_id, user_id, started_at)
      values (v_race, v_user, now() - interval '2 hours') returning id into v_entry;

      -- 구간당 4분 → 16 = 64분, 24 = 96분, 32 = 128분 (모두 30분 이상·4시간 이하)
      for i in 1..v_mode loop
        j := _pft_apply_split(v_entry, i * 240000);
        if j ? 'error' then raise exception '가드: % 모드 % 번째 구간 실패: %', v_mode, i, j; end if;
      end loop;
      -- 넘치는 구간은 거절
      j := _pft_apply_split(v_entry, (v_mode + 1) * 240000);
      if not (j ? 'error') then raise exception '가드: % 모드에서 구간이 넘쳤습니다', v_mode; end if;

      select session_id, total_ms into v_sess, v_total from pft_race_entries where id = v_entry;
      if v_sess is null then raise exception '가드: % 모드 완주에 세션이 없습니다', v_mode; end if;
      select count(*), sum(split_time_ms) into n, s from session_segments where session_id = v_sess;
      if n <> v_mode or s <> v_total then
        raise exception '가드: % 모드 세그먼트 %개·합계 % (기대 %·%)', v_mode, n, s, v_mode, v_total;
      end if;
      select count(*) into n from session_segments where session_id = v_sess and kind = 'station';
      if n <> 8 then raise exception '가드: % 모드 스테이션 %개', v_mode, n; end if;
      select count(*) into n from session_segments where session_id = v_sess and kind = 'run';
      if n <> 8 then raise exception '가드: % 모드 런 %개', v_mode, n; end if;
      if not exists (select 1 from sessions where id = v_sess and user_id = v_user
                       and total_time_ms = v_total and deleted_at is null) then
        raise exception '가드: % 모드 세션 본문이 이상합니다', v_mode;
      end if;

      -- 완주 취소 → 세션 soft delete
      j := _pft_apply_undo(v_entry);
      if not exists (select 1 from sessions where id = v_sess and deleted_at is not null) then
        raise exception '가드: % 모드 완주 취소가 세션을 지우지 않았습니다', v_mode;
      end if;
      if (select session_id from pft_race_entries where id = v_entry) is not null then
        raise exception '가드: % 모드 완주 취소 후 session_id 가 남았습니다', v_mode;
      end if;
    end loop;

    -- PFT 는 그대로: 6구간 → pft_results
    insert into pft_races (code, title, created_by) values ('ZZPFTZ', '가드 PFT', v_user)
    returning id into v_race;
    insert into pft_race_entries (race_id, user_id, started_at)
    values (v_race, v_user, now() - interval '1 hour') returning id into v_entry;
    v_splits := array[240000, 480000, 720000, 960000, 1200000, 1440000];
    for i in 1..6 loop j := _pft_apply_split(v_entry, v_splits[i]); end loop;
    if (select result_id from pft_race_entries where id = v_entry) is null then
      raise exception '가드: PFT 완주가 pft_results 를 만들지 않았습니다';
    end if;
    if (select session_id from pft_race_entries where id = v_entry) is not null then
      raise exception '가드: PFT 완주가 세션을 만들었습니다';
    end if;

    -- 잘못된 조합은 제약이 막는다
    begin
      insert into pft_races (code, title, created_by, format, checkpoints)
      values ('ZZBADZ', '가드', v_user, 'hyrox_sim', 6);
      raise exception '가드: hyrox_sim 6구간이 들어갔습니다';
    exception when check_violation then null;
    end;

    raise exception 'guard_ok';
  exception when raise_exception then
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;

