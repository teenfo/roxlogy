-- ============================================================
-- Roxlogy — PFT 레이스 스태프 타이밍 (운영진이 한 기기로 여러 참가자를 찍는다)
--
-- 092 의 참가자 자가 타이밍에 더해, 레이스 운영진(pft_race_can_manage)이
--   · 참가자를 대신 등록하고(pft_race_staff_add — 크루 회원 검색)
--   · 여러 명을 한 번에 출발시키고(pft_race_staff_start — 웨이브, 서버 now())
--   · 참가자별로 종목 완료·취소·초기화·제거를 찍는다(pft_race_staff_split/undo/reset/remove).
-- 스플릿 적용·완주 처리(pft_results 자동 생성)·취소 규칙은 자가 타이밍과 한 코드다:
--   내부 함수 _pft_apply_split/_pft_apply_undo/_pft_apply_reset 로 빼고 두 경로가 호출한다.
-- 스태프 경과(ms)는 스태프 기기의 보정 시계(서버 오프셋)로 잰 값 — 규칙(단조 증가·3시간)은 같다.
-- ============================================================

-- ---------- 내부: 스플릿·취소·초기화 적용 --------------------------------------
create or replace function public._pft_apply_split(p_entry uuid, p_elapsed_ms integer)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  rec record; v_n int; v_prev int;
  v_age int; v_gender text; v_res uuid; v_cols int[];
begin
  select en.*, r.status as race_status, r.title as race_title
    into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.id = p_entry for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.started_at is null then return jsonb_build_object('error', 'not_started'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished'); end if;
  v_n := cardinality(rec.splits);
  v_prev := case when v_n = 0 then 0 else rec.splits[v_n] end;
  if p_elapsed_ms is null or p_elapsed_ms <= v_prev or p_elapsed_ms > 10800000 then
    return jsonb_build_object('error', 'invalid_elapsed', 'last', v_prev);
  end if;
  update pft_race_entries set splits = splits || p_elapsed_ms, updated_at = now() where id = rec.id;
  v_n := v_n + 1;
  if v_n = 6 then
    select case when birth_year is null then null
                else extract(year from app_today())::int - birth_year end,
           case when gender in ('male','female','other') then gender end
      into v_age, v_gender from profiles where id = rec.user_id;
    v_cols := rec.splits || p_elapsed_ms;
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
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public._pft_apply_split(uuid, integer) from public, anon, authenticated;

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
    update pft_race_entries set finished_at = null, total_ms = null, result_id = null where id = rec.id;
  end if;
  update pft_race_entries set splits = splits[1:v_n-1], updated_at = now() where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public._pft_apply_undo(uuid) from public, anon, authenticated;

create or replace function public._pft_apply_reset(p_entry uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare rec record;
begin
  select en.*, r.status as race_status into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.id = p_entry for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished',
      'hint', '완주 기록은 undo 로 먼저 취소하세요.'); end if;
  update pft_race_entries set started_at = null, splits = '{}', updated_at = now() where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public._pft_apply_reset(uuid) from public, anon, authenticated;

-- ---------- 자가 타이밍 RPC 를 내부 함수 위에 다시 얹는다 (동작 동일) ------------
create or replace function public.pft_race_split(p_race uuid, p_elapsed_ms integer)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_entry uuid;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select id into v_entry from pft_race_entries where race_id = p_race and user_id = v_uid;
  if v_entry is null then return jsonb_build_object('error', 'not_joined'); end if;
  return _pft_apply_split(v_entry, p_elapsed_ms);
end; $$;
create or replace function public.pft_race_undo(p_race uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_entry uuid;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select id into v_entry from pft_race_entries where race_id = p_race and user_id = v_uid;
  if v_entry is null then return jsonb_build_object('error', 'not_joined'); end if;
  return _pft_apply_undo(v_entry);
end; $$;
create or replace function public.pft_race_reset(p_race uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_entry uuid;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select id into v_entry from pft_race_entries where race_id = p_race and user_id = v_uid;
  if v_entry is null then return jsonb_build_object('error', 'not_joined'); end if;
  return _pft_apply_reset(v_entry);
end; $$;
grant execute on function public.pft_race_split(uuid, integer) to authenticated;
grant execute on function public.pft_race_undo(uuid) to authenticated;
grant execute on function public.pft_race_reset(uuid) to authenticated;

-- ---------- 스태프: 회원 검색·등록 ----------------------------------------------
-- 크루 연결 레이스면 그 크루의 활성 회원, 아니면(전체 관리자) 전체 프로필에서 이름으로.
create or replace function public.pft_race_search_members(p_race uuid, p_q text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_crew uuid; v_q text := '%' || trim(coalesce(p_q, '')) || '%';
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if length(trim(coalesce(p_q, ''))) < 1 then return '[]'::jsonb; end if;
  select crew_id into v_crew from pft_races where id = p_race;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', coalesce(nullif(p.display_name, ''), 'Athlete'),
                     'joined', exists (select 1 from pft_race_entries e where e.race_id = p_race and e.user_id = p.id))
                     order by p.display_name)
    from (
      select p.id, p.display_name from profiles p
      where not p.disabled and p.display_name ilike v_q
        and (v_crew is null or exists (
          select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id and m.status = 'active'))
      limit 20) p), '[]'::jsonb);
end; $$;
revoke all on function public.pft_race_search_members(uuid, text) from public;
grant execute on function public.pft_race_search_members(uuid, text) to authenticated;

create or replace function public.pft_race_staff_add(p_race uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_entry uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  select status into v_status from pft_races where id = p_race;
  if v_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if not exists (select 1 from profiles where id = p_user_id and not disabled) then
    return jsonb_build_object('error', 'user_not_found');
  end if;
  insert into pft_race_entries (race_id, user_id) values (p_race, p_user_id)
  on conflict (race_id, user_id) do update set updated_at = now()
  returning id into v_entry;
  return _pft_entry_json(v_entry);
end; $$;
revoke all on function public.pft_race_staff_add(uuid, uuid) from public;
grant execute on function public.pft_race_staff_add(uuid, uuid) to authenticated;

-- ---------- 스태프: 웨이브 출발 ------------------------------------------------
-- 지정한 엔트리 중 아직 시작하지 않은 것만 같은 서버 시각으로 출발시킨다.
-- server_now 를 함께 돌려줘 스태프 기기가 시계 오프셋을 바로 맞춘다.
create or replace function public.pft_race_staff_start(p_race uuid, p_entries uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_now timestamptz := now(); v_n int;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if exists (select 1 from pft_races where id = p_race and status = 'closed') then
    return jsonb_build_object('error', 'race_closed');
  end if;
  update pft_race_entries set started_at = v_now, updated_at = v_now
   where race_id = p_race and id = any(p_entries)
     and started_at is null and finished_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'started', v_n, 'started_at', v_now, 'server_now', v_now);
end; $$;
revoke all on function public.pft_race_staff_start(uuid, uuid[]) from public;
grant execute on function public.pft_race_staff_start(uuid, uuid[]) to authenticated;

-- ---------- 스태프: 참가자별 스플릿·취소·초기화·제거 ---------------------------------
create or replace function public.pft_race_staff_split(p_race uuid, p_entry uuid, p_elapsed_ms integer)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from pft_race_entries where id = p_entry and race_id = p_race) then
    return jsonb_build_object('error', 'not_joined');
  end if;
  return _pft_apply_split(p_entry, p_elapsed_ms);
end; $$;
revoke all on function public.pft_race_staff_split(uuid, uuid, integer) from public;
grant execute on function public.pft_race_staff_split(uuid, uuid, integer) to authenticated;

create or replace function public.pft_race_staff_undo(p_race uuid, p_entry uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from pft_race_entries where id = p_entry and race_id = p_race) then
    return jsonb_build_object('error', 'not_joined');
  end if;
  return _pft_apply_undo(p_entry);
end; $$;
revoke all on function public.pft_race_staff_undo(uuid, uuid) from public;
grant execute on function public.pft_race_staff_undo(uuid, uuid) to authenticated;

create or replace function public.pft_race_staff_reset(p_race uuid, p_entry uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from pft_race_entries where id = p_entry and race_id = p_race) then
    return jsonb_build_object('error', 'not_joined');
  end if;
  return _pft_apply_reset(p_entry);
end; $$;
revoke all on function public.pft_race_staff_reset(uuid, uuid) from public;
grant execute on function public.pft_race_staff_reset(uuid, uuid) to authenticated;

-- 제거: 완주 기록이 있으면 soft delete 하고 엔트리를 지운다
create or replace function public.pft_race_staff_remove(p_race uuid, p_entry uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_res uuid;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if exists (select 1 from pft_races where id = p_race and status = 'closed') then
    return jsonb_build_object('error', 'race_closed');
  end if;
  select result_id into v_res from pft_race_entries where id = p_entry and race_id = p_race;
  if not found then return jsonb_build_object('error', 'not_joined'); end if;
  if v_res is not null then
    update pft_results set deleted_at = now() where id = v_res and deleted_at is null;
  end if;
  delete from pft_race_entries where id = p_entry;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.pft_race_staff_remove(uuid, uuid) from public;
grant execute on function public.pft_race_staff_remove(uuid, uuid) to authenticated;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_user uuid; j jsonb; v_race uuid; v_entry uuid; i int; v_res uuid;
begin
  select id into v_admin from public.profiles where is_admin and not disabled limit 1;
  select id into v_user from public.profiles where not is_admin and not disabled limit 1;
  if v_admin is null then raise notice '가드 건너뜀: 관리자 없음'; return; end if;
  v_user := coalesce(v_user, v_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_create('스태프 가드');
  v_race := (j->>'id')::uuid;
  -- 검색·등록
  j := public.pft_race_search_members(v_race, left((select display_name from public.profiles where id = v_user), 2));
  if jsonb_typeof(j) <> 'array' then raise exception '가드: 검색 응답 이상 %', j; end if;
  j := public.pft_race_staff_add(v_race, v_user);
  if j->>'entry_id' is null then raise exception '가드: 스태프 등록 실패 %', j; end if;
  v_entry := (j->>'entry_id')::uuid;
  -- 비운영진은 스태프 RPC 불가
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  if v_user <> v_admin and (public.pft_race_staff_split(v_race, v_entry, 1000))->>'error' is distinct from 'not_allowed' then
    raise exception '가드: 비운영진이 스태프 스플릿을 찍었다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  -- 웨이브 출발 → 6 스플릿 → 완주 기록
  j := public.pft_race_staff_start(v_race, array[v_entry]);
  if (j->>'started')::int <> 1 or j->'server_now' is null then raise exception '가드: 출발 실패 %', j; end if;
  j := public.pft_race_staff_start(v_race, array[v_entry]);
  if (j->>'started')::int <> 0 then raise exception '가드: 이미 출발한 엔트리가 다시 출발했다'; end if;
  for i in 1..6 loop
    j := public.pft_race_staff_split(v_race, v_entry, i * 250000);
    if j ? 'error' then raise exception '가드: 스태프 스플릿 % 실패 %', i, j; end if;
  end loop;
  if j->>'total_ms' <> '1500000' or j->>'result_id' is null then raise exception '가드: 스태프 완주 이상 %', j; end if;
  v_res := (j->>'result_id')::uuid;
  -- 자가 타이밍 RPC 도 같은 내부 함수로 동작(완주 뒤 거부)
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  if (public.pft_race_split(v_race, 1600000))->>'error' is distinct from 'already_finished' then
    raise exception '가드: 자가 스플릿 리팩터 이상'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  -- 취소·초기화·제거
  j := public.pft_race_staff_undo(v_race, v_entry);
  if jsonb_array_length(j->'splits') <> 5 then raise exception '가드: 스태프 취소 이상 %', j; end if;
  perform 1 from public.pft_results where id = v_res and deleted_at is not null;
  if not found then raise exception '가드: 취소 뒤 기록이 살아 있다'; end if;
  j := public.pft_race_staff_reset(v_race, v_entry);
  if jsonb_array_length(j->'splits') <> 0 or j->>'started_at' is not null then raise exception '가드: 초기화 이상 %', j; end if;
  j := public.pft_race_staff_remove(v_race, v_entry);
  if j->>'ok' is distinct from 'true' then raise exception '가드: 제거 실패 %', j; end if;
  if exists (select 1 from public.pft_race_entries where id = v_entry) then raise exception '가드: 엔트리가 남아 있다'; end if;
  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
