-- ============================================================
-- Roxlogy — 하이록스 시뮬 레이스에도 "볼륨·동작 수정(scaled)" 옵션 (2026-10-03)
--
-- PFT 레이스는 출발할 때(pft_race_start p_scaled) scaled 를 정했지만, 시뮬은 운영진이 조 단위로
-- 출발시켜서 선수가 고를 자리가 없었다. 출발과 떼어 언제든(완주 전) 정할 수 있게 한다.
--   pft_race_set_scaled(race, entry|null, scaled)
--     - entry 를 비우면 내 엔트리. 본인은 완주 전까지, 운영진은 누구든
--     - 완주 뒤: PFT 는 배지가 확정돼 바꾸지 않는다(already_finished). 시뮬은 운영진만 바꿀 수 있다
--     - 진행 중 레이스만(race_closed)
-- 수정된 시뮬 기록은 리더보드에 올리지 않는다(사용자 지정 2026-10-03):
--   _race_sim_session — 완주로 만드는 세션에 leaderboard_excluded = scaled 를 넣는다
--   pft_race_set_scaled — 이미 세션이 있으면 그 세션의 leaderboard_excluded 도 같이 바꾼다
--   (전체·크루·스테이션 리더보드는 모두 leaderboard_excluded 를 거른다)
-- MCP control_timing_race_entry 에 scaled / unscaled 동작을 더한다.
-- 신설·재정의(인자·반환 그대로) — 배포 순서 무관.
-- 되돌리기: 마이그레이션 114 의 _race_sim_session, 132 의 mcp_timing_race_entry 재적용, 새 함수 제거.
-- ============================================================

create or replace function public._race_sim_session(p_entry uuid, p_splits integer[], p_checkpoints integer)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  rec record; v_sid uuid := gen_random_uuid();
  v_pattern text[]; v_per int; i int; v_lap int; v_kind text;
  v_prev int := 0; v_cur int; v_ex uuid; v_machine text; v_div text;
begin
  select e.user_id, e.started_at, e.scaled, r.title into rec
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

  -- 수정(scaled) 기록은 리더보드 제외
  insert into sessions (id, user_id, source_device, analysis_status, started_at, ended_at,
                        total_time_ms, client_updated_at, division, notes, leaderboard_excluded)
  values (v_sid, rec.user_id, 'web', 'pending', rec.started_at,
          rec.started_at + make_interval(secs => p_splits[p_checkpoints] / 1000.0),
          p_splits[p_checkpoints], now(), v_div, left(rec.title, 200), coalesce(rec.scaled, false));

  for i in 1..p_checkpoints loop
    v_lap := ((i - 1) / v_per) + 1;
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

create or replace function public.pft_race_set_scaled(p_race uuid, p_entry uuid, p_scaled boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); r record; e record; v_staff boolean; v_on boolean := coalesce(p_scaled, false);
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select * into r from pft_races where id = p_race;
  if r.id is null then return jsonb_build_object('error', 'race_not_found'); end if;
  if r.status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  v_staff := pft_race_can_manage(p_race);
  if p_entry is null then
    select * into e from pft_race_entries where race_id = p_race and user_id = v_uid;
  else
    select * into e from pft_race_entries where race_id = p_race and id = p_entry;
  end if;
  if e.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if e.user_id <> v_uid and not v_staff then return jsonb_build_object('error', 'not_allowed'); end if;
  if e.finished_at is not null or cardinality(e.splits) >= r.checkpoints then
    if r.format <> 'hyrox_sim' or not v_staff then
      return jsonb_build_object('error', 'already_finished');
    end if;
  end if;

  update pft_race_entries set scaled = v_on, updated_at = now() where id = e.id;
  -- 완주로 만든 세션이 있으면 리더보드 제외도 같이(시뮬)
  if e.session_id is not null then
    update sessions set leaderboard_excluded = v_on where id = e.session_id;
  end if;
  return _pft_entry_json(e.id);
end; $$;
grant execute on function public.pft_race_set_scaled(uuid, uuid, boolean) to authenticated;

-- MCP 선수 조작에 scaled / unscaled 추가 (132 와 같고 두 동작만 더)
create or replace function public.mcp_timing_race_entry(p_token text, p_code text, p_user_id uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; v_entry uuid; j jsonb;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  select id into v_entry from pft_race_entries where race_id = g.race_id and user_id = p_user_id;
  if v_entry is null then return jsonb_build_object('error', 'not_joined'); end if;
  j := case p_action
         when 'pause' then pft_race_staff_pause(g.race_id, v_entry, true)
         when 'resume' then pft_race_staff_pause(g.race_id, v_entry, false)
         when 'dnf' then pft_race_staff_dnf(g.race_id, v_entry, true)
         when 'undo_dnf' then pft_race_staff_dnf(g.race_id, v_entry, false)
         when 'reset' then pft_race_staff_reset(g.race_id, v_entry)
         when 'scaled' then pft_race_set_scaled(g.race_id, v_entry, true)
         when 'unscaled' then pft_race_set_scaled(g.race_id, v_entry, false)
         else jsonb_build_object('error', 'invalid_action') end;
  return j;
end; $$;
grant execute on function public.mcp_timing_race_entry(text, text, uuid, text) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 시뮬 레이스: 선수 본인이 scaled → 운영진이 출발·완주 → 세션이 리더보드 제외 → 운영진이 해제하면 포함.
-- PFT: 완주 뒤엔 못 바꾼다. 크루 밖 사람은 남의 엔트리를 못 바꾼다. 확인 후 되감는다.
do $$
declare
  v_crew uuid; v_slug text; v_staff uuid; v_m1 uuid; v_out uuid; j jsonb;
  v_race uuid; v_entry uuid; v_sess uuid; i int;
begin
  if has_function_privilege('anon', 'public.pft_race_set_scaled(uuid, uuid, boolean)', 'execute') then
    raise exception '가드: scaled 지정이 익명 실행 가능합니다';
  end if;
  if has_function_privilege('authenticated', 'public._race_sim_session(uuid, integer[], integer)', 'execute') then
    raise exception '가드: 시뮬 세션 생성 본체가 열려 있습니다';
  end if;
  select m.crew_id, c.slug, m.user_id into v_crew, v_slug, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner', 'coach')
     and (select count(*) from crew_members x where x.crew_id = m.crew_id and x.status = 'active') >= 2
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 크루 없음'; return; end if;
  select m.user_id into v_m1 from crew_members m join profiles p on p.id = m.user_id and not p.disabled
   where m.crew_id = v_crew and m.status = 'active' and m.user_id <> v_staff
     and m.role not in ('owner', 'coach') limit 1;
  if v_m1 is null then raise notice '가드 건너뜀: 일반 크루원 없음'; return; end if;
  select p.id into v_out from profiles p
   where not p.disabled and not coalesce(p.is_admin, false)
     and not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id) limit 1;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := pft_race_create('가드 scaled 시뮬', v_slug, false, 'hyrox_sim', 16);
    v_race := (j->>'id')::uuid;
    j := pft_race_staff_add(v_race, v_m1);
    v_entry := (j->>'entry_id')::uuid;

    -- 본인이 출발 전에 scaled
    perform set_config('request.jwt.claims', json_build_object('sub', v_m1::text, 'role', 'authenticated')::text, true);
    j := pft_race_set_scaled(v_race, null, true);
    if (j->>'scaled')::boolean is not true then raise exception '가드: 본인 scaled %', j; end if;

    -- 크루 밖 사람은 남의 엔트리를 못 바꾼다
    if v_out is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
      j := pft_race_set_scaled(v_race, v_entry, false);
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 남의 scaled 변경 %', j; end if;
    end if;

    -- 운영진이 조 배정 → 출발 → 16구간 기록(완주) → 세션이 리더보드 제외
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := pft_race_set_wave(v_race, array[v_entry], 1::smallint);
    j := pft_race_staff_start(v_race, array[v_entry]);
    update pft_race_entries set started_at = now() - interval '3 hours' where id = v_entry;
    for i in 1..16 loop
      j := pft_race_staff_split(v_race, v_entry, i * 600000);
      if j ? 'error' then raise exception '가드: 스플릿 % %', i, j; end if;
    end loop;
    select session_id into v_sess from pft_race_entries where id = v_entry;
    if v_sess is null then raise exception '가드: 완주 세션이 안 생김'; end if;
    if not (select leaderboard_excluded from sessions where id = v_sess) then
      raise exception '가드: scaled 완주가 리더보드에 들어감';
    end if;

    -- 본인은 완주 뒤 못 바꾸고, 운영진은 바꾼다 → 세션도 따라 바뀐다
    perform set_config('request.jwt.claims', json_build_object('sub', v_m1::text, 'role', 'authenticated')::text, true);
    j := pft_race_set_scaled(v_race, null, false);
    if j->>'error' is distinct from 'already_finished' then raise exception '가드: 완주 뒤 본인 변경 %', j; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := pft_race_set_scaled(v_race, v_entry, false);
    if j ? 'error' or (select leaderboard_excluded from sessions where id = v_sess) then
      raise exception '가드: 운영진 해제 후 세션 %', j;
    end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
