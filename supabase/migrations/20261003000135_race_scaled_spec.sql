-- ============================================================
-- Roxlogy — 시뮬 레이스의 "scaled 기준" (종목별 변경 내용, 2026-10-03)
--
-- scaled 로 표시된 선수가 어떻게 바꿔 뛰었는지를 레이스마다 운영진이 정해 둔다(사용자 지정:
-- 종목별 정해진 칸, 레이스를 만들 때 입력, 운영진만). 선수별이 아니라 레이스 한 벌이다.
--   pft_races.scaled_spec jsonb — { "<station>": { "amount": 25, "weight": 4 }, ... }
--     station: ski · sledpush · sledpull · burpee · row · farmers · lunges · wallballs
--     amount: 거리 m (월볼은 횟수) 1~5000 정수 / weight: kg 0~300 (스키·버피·로잉은 무게 없음)
--     바꾼 종목만 담는다. 비어 있으면 null.
--   pft_race_set_scaled_spec(race, spec) — 레이스 운영진만, 시뮬만. null/{} 이면 지운다
--   _pft_scaled_spec_clean(spec) — 검사·정리(내부) / _pft_scaled_spec_text(spec) — 한 줄 요약(내부)
-- 표시: 보드 race.scaled_spec(키 추가), 완주 세션 메모(notes)에 "수정(scaled): …" 한 줄 —
--   _race_sim_session 이 넣고, 기준이나 선수의 scaled 가 바뀌면 이미 만든 세션 메모도 다시 쓴다.
-- 신설·재정의(인자·반환 그대로, 키 추가만) — 배포 순서 무관.
-- 되돌리기: 함수들을 없애고 134 의 _race_sim_session·pft_race_set_scaled, 132 의 pft_race_board 재적용,
--           scaled_spec 컬럼 제거.
-- ============================================================

alter table public.pft_races add column if not exists scaled_spec jsonb;

-- 검사·정리: 모르는 종목·범위 밖 값은 invalid_scaled_spec, 빈 항목은 버린다. 결과가 비면 null
create or replace function public._pft_scaled_spec_clean(p_spec jsonb)
returns jsonb
language plpgsql immutable set search_path to 'public' as $$
declare
  v_out jsonb := '{}'::jsonb; k text; v jsonb; v_amt numeric; v_w numeric; v_item jsonb;
  v_keys text[] := array['ski','sledpush','sledpull','burpee','row','farmers','lunges','wallballs'];
  v_weighted text[] := array['sledpush','sledpull','farmers','lunges','wallballs'];
begin
  if p_spec is null or p_spec = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_spec) <> 'object' then raise exception 'invalid_scaled_spec'; end if;
  for k, v in select * from jsonb_each(p_spec) loop
    if not (k = any(v_keys)) or jsonb_typeof(v) not in ('object', 'null') then
      raise exception 'invalid_scaled_spec';
    end if;
    continue when jsonb_typeof(v) = 'null';
    v_amt := case when jsonb_typeof(v->'amount') = 'number' then (v->>'amount')::numeric end;
    v_w := case when jsonb_typeof(v->'weight') = 'number' then (v->>'weight')::numeric end;
    if (v ? 'amount' and jsonb_typeof(v->'amount') not in ('number', 'null'))
       or (v ? 'weight' and jsonb_typeof(v->'weight') not in ('number', 'null')) then
      raise exception 'invalid_scaled_spec';
    end if;
    if v_amt is not null and (v_amt < 1 or v_amt > 5000 or v_amt <> trunc(v_amt)) then
      raise exception 'invalid_scaled_spec';
    end if;
    if v_w is not null and (not (k = any(v_weighted)) or v_w < 0 or v_w > 300) then
      raise exception 'invalid_scaled_spec';
    end if;
    v_item := jsonb_strip_nulls(jsonb_build_object('amount', v_amt::int, 'weight', round(v_w, 1)::float8));  -- float8 로 4.0 → 4
    if v_item <> '{}'::jsonb then v_out := v_out || jsonb_build_object(k, v_item); end if;
  end loop;
  return nullif(v_out, '{}'::jsonb);
end; $$;
revoke all on function public._pft_scaled_spec_clean(jsonb) from public, anon, authenticated;

-- 한 줄 요약 (세션 메모용, 한국어): "슬레드 푸시 25m 102kg · 월볼 75회 4kg"
create or replace function public._pft_scaled_spec_text(p_spec jsonb)
returns text
language sql immutable set search_path to 'public' as $$
  select string_agg(
           n.name
           || coalesce(' ' || (p_spec->n.key->>'amount') || case when n.key = 'wallballs' then '회' else 'm' end, '')
           || coalesce(' ' || (p_spec->n.key->>'weight') || 'kg', ''),
           ' · ' order by n.ord)
    from (values (1, 'ski', '스키에르그'), (2, 'sledpush', '슬레드 푸시'), (3, 'sledpull', '슬레드 풀'),
                 (4, 'burpee', '버피 브로드점프'), (5, 'row', '로잉'), (6, 'farmers', '파머스 캐리'),
                 (7, 'lunges', '샌드백 런지'), (8, 'wallballs', '월볼')) n(ord, key, name)
   where p_spec ? n.key;
$$;
revoke all on function public._pft_scaled_spec_text(jsonb) from public, anon, authenticated;

-- 세션 메모: 레이스 제목 + (scaled 면) 기준 한 줄
create or replace function public._race_sim_notes(p_entry uuid)
returns text
language sql stable security definer set search_path to 'public' as $$
  select left(r.title, 200)
         || case when e.scaled then
              E'\n' || '수정(scaled)' || coalesce(': ' || _pft_scaled_spec_text(r.scaled_spec), '')
            else '' end
    from pft_race_entries e join pft_races r on r.id = e.race_id
   where e.id = p_entry;
$$;
revoke all on function public._race_sim_notes(uuid) from public, anon, authenticated;

-- 완주 세션 만들기 (134 와 같고 notes 만 _race_sim_notes 로)
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

  -- 수정(scaled) 기록은 리더보드 제외, 메모에 기준 한 줄
  insert into sessions (id, user_id, source_device, analysis_status, started_at, ended_at,
                        total_time_ms, client_updated_at, division, notes, leaderboard_excluded)
  values (v_sid, rec.user_id, 'web', 'pending', rec.started_at,
          rec.started_at + make_interval(secs => p_splits[p_checkpoints] / 1000.0),
          p_splits[p_checkpoints], now(), v_div, _race_sim_notes(p_entry), coalesce(rec.scaled, false));

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

-- scaled 지정 (134 와 같고, 세션 메모도 다시 쓴다)
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
    update sessions set leaderboard_excluded = v_on, notes = _race_sim_notes(e.id) where id = e.session_id;
  end if;
  return _pft_entry_json(e.id);
end; $$;
grant execute on function public.pft_race_set_scaled(uuid, uuid, boolean) to authenticated;

-- scaled 기준 지정 — 레이스 운영진만, 시뮬만. 이미 완주한 scaled 선수의 세션 메모도 다시 쓴다
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
  update sessions s set notes = _race_sim_notes(e.id)
    from pft_race_entries e
   where e.race_id = p_race and e.scaled and e.session_id = s.id;
  return jsonb_build_object('ok', true, 'scaled_spec', v_spec,
                            'summary', _pft_scaled_spec_text(coalesce(v_spec, '{}'::jsonb)));
end; $$;
grant execute on function public.pft_race_set_scaled_spec(uuid, jsonb) to authenticated;

-- MCP: scaled 기준 지정 (132 의 가장 관문을 쓴다)
create or replace function public.mcp_timing_race_scaled_spec(p_token text, p_code text, p_spec jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  return pft_race_set_scaled_spec(g.race_id, p_spec);
end; $$;
grant execute on function public.mcp_timing_race_scaled_spec(text, text, jsonb) to anon, authenticated;

-- 보드: race 에 scaled_spec 추가 (132 와 같고 키 하나만 더)
create or replace function public.pft_race_board(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'code', r.code, 'title', r.title, 'status', r.status,
                               'crew', c.name, 'crew_slug', c.slug, 'created_at', r.created_at,
                               'join_open', r.join_open,
                               'format', r.format, 'checkpoints', r.checkpoints,
                               'description', r.description, 'scaled_spec', r.scaled_spec),
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
      where e.race_id = r.id), '[]'::jsonb),
    'waves', coalesce((
      select jsonb_agg(jsonb_build_object('wave', w.wave, 'note', w.note) order by w.wave)
      from pft_race_waves w where w.race_id = r.id), '[]'::jsonb))
  from pft_races r left join crews c on c.id = r.crew_id
  where r.code = upper(trim(coalesce(p_code, '')));
$$;
grant execute on function public.pft_race_board(text) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
do $$
declare
  v_crew uuid; v_slug text; v_staff uuid; v_m1 uuid; j jsonb; v_race uuid; v_entry uuid; v_sess uuid; i int;
begin
  if has_function_privilege('anon', 'public.pft_race_set_scaled_spec(uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public._race_sim_notes(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._pft_scaled_spec_clean(jsonb)', 'execute') then
    raise exception '가드: scaled 기준 함수 권한이 잘못됐습니다';
  end if;
  -- 정리: 빈 항목 버림, 무게 없는 종목에 무게는 거부, 범위 밖 거부
  if _pft_scaled_spec_clean('{"sledpush":{"amount":25,"weight":102.25},"ski":{}}') <> '{"sledpush":{"amount":25,"weight":102.3}}'::jsonb then
    raise exception '가드: 기준 정리 %', _pft_scaled_spec_clean('{"sledpush":{"amount":25,"weight":102.25},"ski":{}}');
  end if;
  if _pft_scaled_spec_clean('{}') is not null then raise exception '가드: 빈 기준'; end if;
  begin
    perform _pft_scaled_spec_clean('{"ski":{"weight":10}}');
    raise exception '가드: 스키에 무게가 들어감';
  exception when raise_exception then
    if sqlerrm <> 'invalid_scaled_spec' then raise; end if;
  end;
  if _pft_scaled_spec_text('{"sledpush":{"amount":25},"wallballs":{"amount":75,"weight":4}}')
     <> '슬레드 푸시 25m · 월볼 75회 4kg' then
    raise exception '가드: 요약 %', _pft_scaled_spec_text('{"sledpush":{"amount":25},"wallballs":{"amount":75,"weight":4}}');
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

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := pft_race_create('가드 scaled 기준', v_slug, false, 'hyrox_sim', 16);
    v_race := (j->>'id')::uuid;
    j := pft_race_set_scaled_spec(v_race, '{"sledpush":{"amount":25}}');
    if j ? 'error' or j->>'summary' <> '슬레드 푸시 25m' then raise exception '가드: 기준 지정 %', j; end if;
    if pft_race_board((select code from pft_races where id = v_race))->'race'->'scaled_spec' <> '{"sledpush":{"amount":25}}'::jsonb then
      raise exception '가드: 보드에 기준 없음';
    end if;
    j := pft_race_staff_add(v_race, v_m1);
    v_entry := (j->>'entry_id')::uuid;
    j := pft_race_set_scaled(v_race, v_entry, true);
    j := pft_race_set_wave(v_race, array[v_entry], 1::smallint);
    j := pft_race_staff_start(v_race, array[v_entry]);
    update pft_race_entries set started_at = now() - interval '3 hours' where id = v_entry;
    for i in 1..16 loop
      j := pft_race_staff_split(v_race, v_entry, i * 600000);
    end loop;
    select session_id into v_sess from pft_race_entries where id = v_entry;
    if (select notes from sessions where id = v_sess) <> E'가드 scaled 기준\n수정(scaled): 슬레드 푸시 25m' then
      raise exception '가드: 세션 메모 %', (select notes from sessions where id = v_sess);
    end if;
    -- 기준을 바꾸면 이미 만든 세션 메모도 바뀐다
    j := pft_race_set_scaled_spec(v_race, '{"wallballs":{"amount":75,"weight":4}}');
    if (select notes from sessions where id = v_sess) <> E'가드 scaled 기준\n수정(scaled): 월볼 75회 4kg' then
      raise exception '가드: 세션 메모 갱신 %', (select notes from sessions where id = v_sess);
    end if;
    -- 일반 크루원은 기준을 못 바꾼다
    perform set_config('request.jwt.claims', json_build_object('sub', v_m1::text, 'role', 'authenticated')::text, true);
    j := pft_race_set_scaled_spec(v_race, '{}');
    if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 크루원이 기준 변경 %', j; end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
