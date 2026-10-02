-- ============================================================
-- Roxlogy — 레이스 선수 일시정지 (시간을 실제로 멈춘다) (2026-10-02)
--
-- 스태프가 선수 카드에서 일시정지하면 그 선수의 경과 시간이 멈추고, 재개하면 멈춘 지점부터
-- 이어서 흐른다. 구간·총 기록은 멈춘 시간을 뺀 값이다.
--   paused_at  — 지금 멈춰 있으면 멈춘 시각, 아니면 null
--   paused_ms  — 지금까지 멈춰 있던 시간의 합(ms). 재개할 때 더한다
-- 경과(ms) = now − started_at − paused_ms − (paused_at 이 있으면 now − paused_at)
-- 구간 기록은 클라이언트가 이 경과를 계산해 보낸다(_pft_apply_split). 멈춰 있는 동안의 기록은
-- 서버가 entry_paused 로 거부한다.
-- 리셋·출발은 정지 기록을 비우고, 중도포기는 정지를 풀어 누적에 넣는다.
-- 응답 JSON(_pft_entry_json · pft_race_board)에는 두 키를 덧붙이기만 한다 — 옛 화면은 무시한다.
-- 되돌리기: pft_race_staff_pause 를 없애고 아래 함수들을 직전 정의로 되돌린 뒤 두 칸을 뺀다.
-- ============================================================

alter table public.pft_race_entries
  add column if not exists paused_at timestamptz,
  add column if not exists paused_ms integer not null default 0;

-- ---------- 응답 JSON ----------------------------------------------------------------
create or replace function public._pft_entry_json(p_entry uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'entry_id', e.id, 'race_id', e.race_id, 'started_at', e.started_at,
    'splits', to_jsonb(e.splits), 'finished_at', e.finished_at, 'total_ms', e.total_ms,
    'scaled', e.scaled, 'result_id', e.result_id, 'dnf_at', e.dnf_at, 'status', r.status,
    'session_id', e.session_id,
    'paused_at', e.paused_at, 'paused_ms', e.paused_ms)
  from pft_race_entries e join pft_races r on r.id = e.race_id where e.id = p_entry;
$$;

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
        'paused_at', e.paused_at, 'paused_ms', e.paused_ms,
        'badge', res.badge) order by e.joined_at)
      from pft_race_entries e
      join profiles p on p.id = e.user_id
      left join pft_results res on res.id = e.result_id
      where e.race_id = r.id), '[]'::jsonb))
  from pft_races r left join crews c on c.id = r.crew_id
  where r.code = upper(trim(coalesce(p_code, '')));
$$;
grant execute on function public.pft_race_board(text) to anon, authenticated;

-- ---------- 구간 기록: 멈춰 있으면 거부 ------------------------------------------------
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
  if rec.paused_at is not null then return jsonb_build_object('error', 'entry_paused'); end if;
  v_max := rec.race_checkpoints;
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

-- ---------- 리셋: 정지 기록도 비운다 ------------------------------------------------------
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
  update pft_race_entries
     set started_at = null, splits = '{}', dnf_at = null, paused_at = null, paused_ms = 0,
         updated_at = now()
   where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;

-- ---------- 중도포기: 멈춰 있었다면 정지를 풀어 누적에 넣는다 -------------------------------
create or replace function public._pft_apply_dnf(p_entry uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare rec record;
begin
  select en.*, r.status as race_status into rec
    from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.id = p_entry for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;

  if p_on then
    if rec.started_at is null then
      return jsonb_build_object('error', 'not_started');
    end if;
    if rec.finished_at is not null then
      return jsonb_build_object('error', 'already_finished',
        'hint', '완주 기록은 undo 로 먼저 취소하세요.');
    end if;
    update pft_race_entries
       set dnf_at = now(),
           paused_ms = paused_ms + case when paused_at is null then 0
                         else (extract(epoch from (now() - paused_at)) * 1000)::int end,
           paused_at = null,
           updated_at = now()
     where id = rec.id;
  else
    update pft_race_entries set dnf_at = null, updated_at = now() where id = rec.id;
  end if;

  return _pft_entry_json(rec.id);
end; $$;

-- ---------- 출발: 정지 기록을 비우고 시작 -------------------------------------------------
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
  update pft_race_entries set started_at = v_now, paused_at = null, paused_ms = 0, updated_at = v_now
   where race_id = p_race and id = any(p_entries)
     and started_at is null and finished_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'started', v_n, 'started_at', v_now, 'server_now', v_now);
end; $$;
grant execute on function public.pft_race_staff_start(uuid, uuid[]) to authenticated;

create or replace function public.pft_race_start(p_race uuid, p_scaled boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); rec record;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select en.*, r.status into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.race_id = p_race and en.user_id = v_uid;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished'); end if;
  if cardinality(rec.splits) > 0 then return jsonb_build_object('error', 'already_started'); end if;
  update pft_race_entries set started_at = now(), scaled = coalesce(p_scaled, false),
         paused_at = null, paused_ms = 0, updated_at = now()
   where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
grant execute on function public.pft_race_start(uuid, boolean) to authenticated;

-- ---------- 일시정지 / 재개 (운영진) ----------------------------------------------------
create or replace function public.pft_race_staff_pause(p_race uuid, p_entry uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare rec record;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  select en.*, r.status as race_status into rec
    from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.id = p_entry and en.race_id = p_race for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.started_at is null then return jsonb_build_object('error', 'not_started'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished'); end if;
  if rec.dnf_at is not null then return jsonb_build_object('error', 'entry_dnf'); end if;

  if p_on then
    if rec.paused_at is null then
      update pft_race_entries set paused_at = now(), updated_at = now() where id = rec.id;
    end if;
  elsif rec.paused_at is not null then
    update pft_race_entries
       set paused_ms = paused_ms + (extract(epoch from (now() - paused_at)) * 1000)::int,
           paused_at = null, updated_at = now()
     where id = rec.id;
  end if;
  return _pft_entry_json(rec.id);
end; $$;
grant execute on function public.pft_race_staff_pause(uuid, uuid, boolean) to authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 실제 참가 기록 하나를 "10분 전 출발"로 만들어 운영진 시점으로 멈춤·거부·재개·누적을 확인 후 되감는다.
do $$
declare v_entry uuid; v_race uuid; v_mgr uuid; j jsonb;
begin
  if has_function_privilege('anon', 'public.pft_race_staff_pause(uuid, uuid, boolean)', 'execute') then
    raise exception '가드: 일시정지가 익명 실행 가능합니다';
  end if;
  select e.id, e.race_id, r.created_by into v_entry, v_race, v_mgr
    from pft_race_entries e join pft_races r on r.id = e.race_id
   where r.created_by is not null order by e.joined_at desc limit 1;
  if v_entry is null then raise notice '가드 건너뜀: 참가 기록 없음'; return; end if;

  begin
    update pft_races set status = 'open' where id = v_race;
    update pft_race_entries
       set started_at = now() - interval '10 minutes', splits = '{}', finished_at = null,
           total_ms = null, dnf_at = null, paused_at = null, paused_ms = 0
     where id = v_entry;
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr::text, 'role', 'authenticated')::text, true);

    j := pft_race_staff_pause(v_race, v_entry, true);
    if j ? 'error' or j->>'paused_at' is null then raise exception '가드: 일시정지 실패 %', j; end if;
    j := pft_race_staff_split(v_race, v_entry, 60000);
    if j->>'error' is distinct from 'entry_paused' then raise exception '가드: 멈춘 동안 기록이 들어감 %', j; end if;

    -- 5초 멈춰 있었던 것으로 만들고 재개 → 누적 5초 이상
    update pft_race_entries set paused_at = now() - interval '5 seconds' where id = v_entry;
    j := pft_race_staff_pause(v_race, v_entry, false);
    if j->>'paused_at' is not null or (j->>'paused_ms')::int < 5000 then
      raise exception '가드: 재개 누적 오류 %', j;
    end if;
    j := pft_race_staff_split(v_race, v_entry, 60000);
    if j ? 'error' then raise exception '가드: 재개 뒤 기록 실패 %', j; end if;

    -- 리셋하면 정지 기록이 비워진다
    j := pft_race_staff_reset(v_race, v_entry);
    if (j->>'paused_ms')::int <> 0 then raise exception '가드: 리셋 후 정지 누적이 남음 %', j; end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
