-- ============================================================
-- Roxlogy — scaled 는 레이스 단위 (2026-10-04, 사용자 지정)
--
-- "scaled 기준이 있는 시뮬 레이스 = 레이스 전체가 scaled" — 참가자 모두가 그 기준으로 뛴다.
-- 선수별 scaled 체크는 화면에서 걷어낸다(웹). DB 는 선수별 scaled 도 그대로 받되(MCP·옛 화면 호환),
-- 판정을 "선수 scaled 또는 레이스에 기준 있음"으로 넓힌다:
--   _race_entry_is_scaled(entry)  — 판정 한 곳(내부)
--   _race_sim_notes               — 판정이 참이면 메모에 기준 한 줄
--   _race_sim_session             — 판정이 참이면 리더보드 제외
--   pft_race_set_scaled           — 세션 제외 여부를 판정으로(선수 표시를 꺼도 레이스 기준이 있으면 제외 유지)
--   pft_race_set_scaled_spec      — 기준을 넣거나 빼면 이 레이스의 완주 세션 전부를 다시 맞춘다
-- 레이스 보드 순위는 그대로(같은 기준으로 뛴 사람끼리라 순위가 의미 있다 — 선수별 scaled 만 순위 제외).
-- 이미 만든 세션도 한 번 다시 맞춘다. 재정의(인자·반환 그대로) + 신설 — 배포 순서 무관.
-- 되돌리기: 135·136 의 해당 함수 정의 재적용.
-- ============================================================

create or replace function public._race_entry_is_scaled(p_entry uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(e.scaled, false) or r.scaled_spec is not null
    from pft_race_entries e join pft_races r on r.id = e.race_id
   where e.id = p_entry;
$$;
revoke all on function public._race_entry_is_scaled(uuid) from public, anon, authenticated;

create or replace function public._race_sim_notes(p_entry uuid)
returns text
language sql stable security definer set search_path to 'public' as $$
  select left(r.title, 200)
         || case when e.scaled or r.scaled_spec is not null then
              E'\n'
              || case l.loc when 'en' then 'Scaled' when 'es' then 'Adaptado (scaled)' else '수정(scaled)' end
              || coalesce(': ' || _pft_scaled_spec_text_l(r.scaled_spec, l.loc), '')
            else '' end
    from pft_race_entries e
    join pft_races r on r.id = e.race_id
    cross join lateral (select _pft_race_locale(r.id) as loc) l
   where e.id = p_entry;
$$;
revoke all on function public._race_sim_notes(uuid) from public, anon, authenticated;

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

  -- scaled(레이스 기준이 있거나 선수 표시) 기록은 리더보드 제외, 메모에 기준 한 줄
  insert into sessions (id, user_id, source_device, analysis_status, started_at, ended_at,
                        total_time_ms, client_updated_at, division, notes, leaderboard_excluded)
  values (v_sid, rec.user_id, 'web', 'pending', rec.started_at,
          rec.started_at + make_interval(secs => p_splits[p_checkpoints] / 1000.0),
          p_splits[p_checkpoints], now(), v_div, _race_sim_notes(p_entry), _race_entry_is_scaled(p_entry));

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
  -- 완주로 만든 세션이 있으면 리더보드 제외·메모도 같이(시뮬)
  if e.session_id is not null then
    update sessions set leaderboard_excluded = _race_entry_is_scaled(e.id), notes = _race_sim_notes(e.id)
     where id = e.session_id;
  end if;
  return _pft_entry_json(e.id);
end; $$;
grant execute on function public.pft_race_set_scaled(uuid, uuid, boolean) to authenticated;

create or replace function public.pft_race_set_scaled_spec(p_race uuid, p_spec jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_spec jsonb;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into r from pft_races where id = p_race;
  if r.id is null then return jsonb_build_object('error', 'race_not_found'); end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if r.format <> 'hyrox_sim' then return jsonb_build_object('error', 'invalid_format'); end if;
  begin
    v_spec := _pft_scaled_spec_clean(p_spec);
  exception when raise_exception then
    return jsonb_build_object('error', 'invalid_scaled_spec');
  end;
  update pft_races set scaled_spec = v_spec where id = p_race;
  -- 기준이 생기면 이 레이스의 완주 기록 전부가 scaled — 메모·리더보드 제외를 다시 맞춘다
  update sessions s set notes = _race_sim_notes(e.id), leaderboard_excluded = _race_entry_is_scaled(e.id)
    from pft_race_entries e
   where e.race_id = p_race and e.session_id = s.id;
  return jsonb_build_object('ok', true, 'scaled_spec', v_spec,
                            'summary', _pft_scaled_spec_text_l(coalesce(v_spec, '{}'::jsonb), _pft_race_locale(p_race)));
end; $$;
grant execute on function public.pft_race_set_scaled_spec(uuid, jsonb) to authenticated;

-- 이미 만든 시뮬 세션을 새 판정으로 한 번 맞춘다
update sessions s set notes = _race_sim_notes(e.id), leaderboard_excluded = _race_entry_is_scaled(e.id)
  from pft_race_entries e join pft_races r on r.id = e.race_id
 where r.format = 'hyrox_sim' and e.session_id = s.id
   and (r.scaled_spec is not null or e.scaled);

-- ---------- 가드 -----------------------------------------------------------------
-- 기준 있는 레이스: 선수 표시 없이 완주해도 메모·리더보드 제외. 기준을 빼면 포함으로 돌아간다.
do $$
declare v_crew uuid; v_slug text; v_staff uuid; v_m1 uuid; j jsonb; v_race uuid; v_entry uuid; v_sess uuid; i int;
begin
  if has_function_privilege('authenticated', 'public._race_entry_is_scaled(uuid)', 'execute') then
    raise exception '가드: 판정 함수가 열려 있습니다';
  end if;
  select m.crew_id, c.slug, m.user_id into v_crew, v_slug, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner', 'coach')
     and (select count(*) from crew_members x where x.crew_id = m.crew_id and x.status = 'active') >= 2
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 크루 없음'; return; end if;
  select m.user_id into v_m1 from crew_members m join profiles p on p.id = m.user_id and not p.disabled
   where m.crew_id = v_crew and m.status = 'active' and m.user_id <> v_staff limit 1;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := pft_race_create('가드 레이스 scaled', v_slug, false, 'hyrox_sim', 16);
    v_race := (j->>'id')::uuid;
    j := pft_race_set_scaled_spec(v_race, '{"sledpush":{"amount":25}}');
    j := pft_race_staff_add(v_race, v_m1);
    v_entry := (j->>'entry_id')::uuid;   -- 선수 scaled 표시는 하지 않는다
    j := pft_race_set_wave(v_race, array[v_entry], 1::smallint);
    j := pft_race_staff_start(v_race, array[v_entry]);
    update pft_race_entries set started_at = now() - interval '3 hours' where id = v_entry;
    for i in 1..16 loop
      j := pft_race_staff_split(v_race, v_entry, i * 600000);
    end loop;
    select session_id into v_sess from pft_race_entries where id = v_entry;
    if not (select leaderboard_excluded from sessions where id = v_sess)
       or (select notes from sessions where id = v_sess) not like '%25m%' then
      raise exception '가드: 레이스 기준만으로 scaled 처리 안 됨 %', (select notes from sessions where id = v_sess);
    end if;
    j := pft_race_set_scaled_spec(v_race, '{}');
    if (select leaderboard_excluded from sessions where id = v_sess)
       or (select notes from sessions where id = v_sess) like '%25m%' then
      raise exception '가드: 기준을 뺐는데 그대로 %', (select notes from sessions where id = v_sess);
    end if;
    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
