-- ============================================================
-- Roxlogy — 레이스(PFT·하이록스 시뮬) 내용 수정 + MCP 레이스 도구 (2026-10-03)
--
-- 1) 웹: 레이스 내용 수정
--    pft_races.description(선택, 500자) 추가 · pft_race_update(race, title, description, checkpoints)
--    - 레이스 운영진(pft_race_can_manage)만. 제목·설명은 언제든(종료 후 포함)
--    - 시뮬 구간 수(16/24/32)는 진행 중이고 아무도 출발하지 않았을 때만(race_started / race_closed)
--    - 종목(PFT ↔ 시뮬)은 바꾸지 않는다 — 메뉴(/pft · /timing)와 주소가 갈린다
--    pft_race_board 의 race 에 description 을 덧붙인다(키 추가만).
-- 2) MCP: 토큰 사용자로 "가장"해서 웹 RPC 를 그대로 부른다(_mcp_act_as).
--    권한 판정·규칙이 웹과 한 벌이라 갈라지지 않는다. 각 RPC 요청은 자기 트랜잭션이라
--    가장(set_config … true)은 그 호출 안에서만 산다. 쓰기는 mcp_can_write 관문을 먼저 지난다.
--    mcp_timing_races / _race_get / _race_create / _race_update / _race_members / _race_add /
--    _race_remove / _race_set_wave / _race_wave_note / _race_start / _race_entry
--    레이스 자체를 없애는 도구는 행을 지워야 해서 마이그레이션 133(SQL Editor)으로 따로 둔다.
-- 되돌리기: 함수들을 없애고 126 의 pft_race_board 재적용, description 컬럼 제거.
-- ============================================================

alter table public.pft_races add column if not exists description text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pft_races_description_len') then
    alter table public.pft_races add constraint pft_races_description_len
      check (description is null or char_length(description) between 1 and 500);
  end if;
end $$;

-- ---------- 웹: 내용 수정 ----------------------------------------------------------
create or replace function public.pft_race_update(
  p_race uuid, p_title text default null, p_description text default null,
  p_clear_description boolean default false, p_checkpoints integer default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_title text; v_desc text; v_cp int;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into r from pft_races where id = p_race;
  if r.id is null then return jsonb_build_object('error', 'race_not_found'); end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;

  v_title := r.title;
  if p_title is not null then
    v_title := btrim(p_title);
    if char_length(v_title) < 1 or char_length(v_title) > 80 then
      return jsonb_build_object('error', 'invalid_title');
    end if;
  end if;

  v_desc := r.description;
  if coalesce(p_clear_description, false) then
    v_desc := null;
  elsif p_description is not null then
    v_desc := nullif(btrim(p_description), '');
    if char_length(v_desc) > 500 then return jsonb_build_object('error', 'description_too_long'); end if;
  end if;

  v_cp := r.checkpoints;
  if p_checkpoints is not null and p_checkpoints <> r.checkpoints then
    if r.format <> 'hyrox_sim' or p_checkpoints not in (16, 24, 32) then
      return jsonb_build_object('error', 'invalid_checkpoints');
    end if;
    if r.status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
    if exists (select 1 from pft_race_entries e where e.race_id = p_race
                and (e.started_at is not null or cardinality(e.splits) > 0
                     or e.finished_at is not null or e.dnf_at is not null)) then
      return jsonb_build_object('error', 'race_started');
    end if;
    v_cp := p_checkpoints;
  end if;

  update pft_races set title = v_title, description = v_desc, checkpoints = v_cp where id = p_race;
  return jsonb_build_object('ok', true, 'id', r.id, 'code', r.code, 'title', v_title,
                            'description', v_desc, 'format', r.format, 'checkpoints', v_cp);
end; $$;
grant execute on function public.pft_race_update(uuid, text, text, boolean, integer) to authenticated;

-- 보드: race 에 description 추가 (126 과 같고 키 하나만 더)
create or replace function public.pft_race_board(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'code', r.code, 'title', r.title, 'status', r.status,
                               'crew', c.name, 'crew_slug', c.slug, 'created_at', r.created_at,
                               'join_open', r.join_open,
                               'format', r.format, 'checkpoints', r.checkpoints,
                               'description', r.description),
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

-- ---------- MCP 공통 ---------------------------------------------------------------
-- 토큰 사용자로 가장한다 — 이 트랜잭션(=이 RPC 호출) 안에서만. auth.uid() 가 두 설정을 모두 본다.
create or replace function public._mcp_act_as(p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end; $$;
revoke all on function public._mcp_act_as(uuid) from public, anon, authenticated;

-- 쓰기 도구 공통 관문: 토큰 → 사용자, 쓰기 허용 여부, 가장, 레이스 id
--   반환: (uid, race_id, err) — err 가 있으면 그대로 돌려준다. uid 가 null 이면 토큰 무효(null 반환).
create or replace function public._mcp_race_gate(p_token text, p_code text, p_write boolean)
returns table(uid uuid, race_id uuid, err jsonb)
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token); v_race uuid;
begin
  if v_uid is null then return query select null::uuid, null::uuid, null::jsonb; return; end if;
  if p_write and not mcp_can_write(p_token) then
    return query select v_uid, null::uuid, jsonb_build_object('error', 'read_only_token'); return;
  end if;
  perform _mcp_act_as(v_uid);
  if p_code is not null then
    select r.id into v_race from pft_races r where r.code = upper(btrim(p_code));
    if v_race is null then
      return query select v_uid, null::uuid, jsonb_build_object('error', 'race_not_found'); return;
    end if;
  end if;
  return query select v_uid, v_race, null::jsonb;
end; $$;
revoke all on function public._mcp_race_gate(text, text, boolean) from public, anon, authenticated;

-- 선수 상태(웹 lib/pft-race.ts entryState 와 같은 판정 + 일시정지)
create or replace function public._pft_entry_state(e pft_race_entries, p_cp int)
returns text
language sql immutable set search_path to 'public' as $$
  select case
    when e.dnf_at is not null then 'dnf'
    when e.finished_at is not null or cardinality(e.splits) >= p_cp then 'finished'
    when e.started_at is null and cardinality(e.splits) = 0 then 'waiting'
    when e.paused_at is not null then 'paused'
    else 'running' end;
$$;
revoke all on function public._pft_entry_state(pft_race_entries, int) from public, anon, authenticated;

-- ---------- MCP: 목록 · 상세 ---------------------------------------------------------
create or replace function public.mcp_timing_races(p_token text, p_slug text default null,
                                                  p_include_closed boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record;
begin
  select * into g from _mcp_race_gate(p_token, null, false);
  if g.uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'code', s.code, 'title', s.title, 'description', s.description,
             'format', s.format, 'checkpoints', s.checkpoints, 'status', s.status,
             'join_open', s.join_open, 'crew', s.crew, 'crew_slug', s.crew_slug,
             'created_at', s.created_at, 'closed_at', s.closed_at,
             'can_manage', s.can_manage, 'joined', s.joined,
             'entries', s.entries, 'waiting', s.waiting, 'started', s.started, 'finished', s.finished)
           order by s.created_at desc)
    from (
      select r.*, c.name as crew, c.slug as crew_slug,
             pft_race_can_manage(r.id) as can_manage,
             exists (select 1 from pft_race_entries e where e.race_id = r.id and e.user_id = g.uid) as joined,
             (select count(*) from pft_race_entries e where e.race_id = r.id) as entries,
             (select count(*) from pft_race_entries e where e.race_id = r.id
               and e.started_at is null and cardinality(e.splits) = 0) as waiting,
             (select count(*) from pft_race_entries e where e.race_id = r.id
               and (e.started_at is not null or cardinality(e.splits) > 0)) as started,
             (select count(*) from pft_race_entries e where e.race_id = r.id
               and e.finished_at is not null) as finished
        from pft_races r left join crews c on c.id = r.crew_id
       where (coalesce(p_include_closed, false) or r.status = 'open')
         and (p_slug is null or c.slug = p_slug)
         and (r.created_by = g.uid
              or (r.crew_id is not null and is_crew_staff(r.crew_id))
              or exists (select 1 from pft_race_entries e where e.race_id = r.id and e.user_id = g.uid)
              or (r.status = 'open' and r.crew_id is not null and exists (
                    select 1 from crew_members m where m.crew_id = r.crew_id
                       and m.user_id = g.uid and m.status = 'active')))
       order by r.created_at desc
       limit 50) s), '[]'::jsonb);
end; $$;
grant execute on function public.mcp_timing_races(text, text, boolean) to anon, authenticated;

create or replace function public.mcp_timing_race_get(p_token text, p_code text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; b jsonb; r record;
begin
  select * into g from _mcp_race_gate(p_token, p_code, false);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  select * into r from pft_races where id = g.race_id;
  b := pft_race_board(r.code);
  return jsonb_build_object(
    'race', b->'race',
    'server_now', b->'server_now',
    'can_manage', pft_race_can_manage(r.id),
    'next_wave', coalesce((select max(e.wave) from pft_race_entries e where e.race_id = r.id), 0) + 1,
    'waves', coalesce((
      select jsonb_agg(jsonb_build_object(
               'wave', w.wave,
               'note', (select n.note from pft_race_waves n where n.race_id = r.id and n.wave = w.wave),
               'members', w.cnt, 'waiting', w.waiting) order by w.wave)
        from (select e.wave, count(*) as cnt,
                     count(*) filter (where _pft_entry_state(e, r.checkpoints) = 'waiting') as waiting
                from pft_race_entries e where e.race_id = r.id and e.wave is not null
               group by e.wave) w), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entry_id', e.id, 'user_id', e.user_id,
               'name', coalesce(nullif(p.display_name, ''), 'Athlete'),
               'state', _pft_entry_state(e, r.checkpoints),
               'wave', e.wave, 'started_at', e.started_at,
               'splits_done', cardinality(e.splits), 'splits_ms', to_jsonb(e.splits),
               'total_ms', e.total_ms, 'finished_at', e.finished_at,
               'dnf_at', e.dnf_at, 'paused_at', e.paused_at, 'paused_ms', e.paused_ms,
               'scaled', e.scaled) order by e.joined_at)
        from pft_race_entries e join profiles p on p.id = e.user_id
       where e.race_id = r.id), '[]'::jsonb));
end; $$;
grant execute on function public.mcp_timing_race_get(text, text) to anon, authenticated;

-- ---------- MCP: 만들기 · 고치기 ---------------------------------------------------
create or replace function public.mcp_timing_race_create(
  p_token text, p_title text, p_slug text default null, p_format text default 'hyrox_sim',
  p_checkpoints integer default null, p_join_open boolean default true, p_description text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; j jsonb; u jsonb;
begin
  select * into g from _mcp_race_gate(p_token, null, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  begin
    j := pft_race_create(p_title, p_slug, coalesce(p_join_open, true), coalesce(p_format, 'hyrox_sim'), p_checkpoints);
    if j ? 'error' then raise exception using message = j->>'error'; end if;
    if nullif(btrim(coalesce(p_description, '')), '') is not null then
      u := pft_race_update((j->>'id')::uuid, null, p_description, false, null);
      if u ? 'error' then raise exception using message = u->>'error'; end if;
    end if;
  exception when raise_exception then
    return jsonb_build_object('error', sqlerrm) || coalesce(j - 'ok' - 'id' - 'code' - 'join_open' - 'format' - 'checkpoints', '{}'::jsonb);
  end;
  return mcp_timing_race_get(p_token, j->>'code');
end; $$;
grant execute on function public.mcp_timing_race_create(text, text, text, text, integer, boolean, text)
  to anon, authenticated;

create or replace function public.mcp_timing_race_update(
  p_token text, p_code text, p_title text default null, p_description text default null,
  p_clear_description boolean default false, p_checkpoints integer default null,
  p_join_open boolean default null, p_status text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; j jsonb;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  -- 여러 항목을 한 번에 — 하나라도 실패하면 전부 되돌린다
  begin
    if p_title is not null or p_description is not null or coalesce(p_clear_description, false)
       or p_checkpoints is not null then
      j := pft_race_update(g.race_id, p_title, p_description, p_clear_description, p_checkpoints);
      if j ? 'error' then raise exception using message = j->>'error'; end if;
    end if;
    if p_join_open is not null then
      j := pft_race_set_join_open(g.race_id, p_join_open);
      if j ? 'error' then raise exception using message = j->>'error'; end if;
    end if;
    if p_status is not null then
      j := pft_race_set_status(g.race_id, p_status);
      if j ? 'error' then raise exception using message = j->>'error'; end if;
    end if;
  exception when raise_exception then
    return jsonb_build_object('error', sqlerrm);
  end;
  return mcp_timing_race_get(p_token, p_code);
end; $$;
grant execute on function public.mcp_timing_race_update(text, text, text, text, boolean, integer, boolean, text)
  to anon, authenticated;

-- ---------- MCP: 참가자 ------------------------------------------------------------
-- 추가 후보 — 크루 레이스면 그 크루 활동 회원(q 로 이름 거르기), 크루 없는 레이스면 q 필수
create or replace function public.mcp_timing_race_members(p_token text, p_code text, p_q text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; v_crew uuid; v_q text := btrim(coalesce(p_q, ''));
begin
  select * into g from _mcp_race_gate(p_token, p_code, false);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  if not pft_race_can_manage(g.race_id) then return jsonb_build_object('error', 'not_allowed'); end if;
  select crew_id into v_crew from pft_races where id = g.race_id;
  if v_crew is null and v_q = '' then return jsonb_build_object('error', 'query_required'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.id,
             'name', coalesce(nullif(p.display_name, ''), 'Athlete'),
             'joined', e.id is not null, 'wave', e.wave,
             'state', case when e.id is null then null
                           else _pft_entry_state(e, (select checkpoints from pft_races where id = g.race_id)) end)
           order by e.id is not null, p.display_name)
      from profiles p
      left join pft_race_entries e on e.race_id = g.race_id and e.user_id = p.id
     where not p.disabled
       and (v_q = '' or p.display_name ilike '%' || v_q || '%')
       and (v_crew is null or exists (select 1 from crew_members m
                                       where m.crew_id = v_crew and m.user_id = p.id and m.status = 'active'))
     limit 200), '[]'::jsonb);
end; $$;
grant execute on function public.mcp_timing_race_members(text, text, text) to anon, authenticated;

create or replace function public.mcp_timing_race_add(p_token text, p_code text, p_user_ids uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; v_crew uuid; v_uid uuid; j jsonb; v_res jsonb := '[]'::jsonb;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  if not pft_race_can_manage(g.race_id) then return jsonb_build_object('error', 'not_allowed'); end if;
  if coalesce(cardinality(p_user_ids), 0) = 0 or cardinality(p_user_ids) > 100 then
    return jsonb_build_object('error', 'invalid_users');
  end if;
  select crew_id into v_crew from pft_races where id = g.race_id;
  foreach v_uid in array (select array_agg(distinct u) from unnest(p_user_ids) u) loop
    -- 크루 레이스는 그 크루 활동 회원만(웹 검색과 같은 범위)
    if v_crew is not null and not exists (select 1 from crew_members m
                                           where m.crew_id = v_crew and m.user_id = v_uid and m.status = 'active') then
      v_res := v_res || jsonb_build_object('user_id', v_uid, 'error', 'not_a_member');
      continue;
    end if;
    j := pft_race_staff_add(g.race_id, v_uid);
    v_res := v_res || (jsonb_build_object('user_id', v_uid,
              'name', (select coalesce(nullif(display_name, ''), 'Athlete') from profiles where id = v_uid))
              || case when j ? 'error' then jsonb_build_object('error', j->>'error')
                      else jsonb_build_object('ok', true, 'entry_id', j->>'entry_id', 'wave', j->'wave') end);
  end loop;
  return jsonb_build_object('ok', true, 'results', v_res,
    'entries', (select count(*) from pft_race_entries where race_id = g.race_id));
end; $$;
grant execute on function public.mcp_timing_race_add(text, text, uuid[]) to anon, authenticated;

-- 참가자 빼기 — 출발 전 선수만 기본. include_started=true 면 출발·완주한 선수도 빼고 그 기록(결과·세션)도 지워진다
create or replace function public.mcp_timing_race_remove(p_token text, p_code text, p_user_ids uuid[],
                                                        p_include_started boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; e record; j jsonb; v_res jsonb := '[]'::jsonb; v_cp int;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  if not pft_race_can_manage(g.race_id) then return jsonb_build_object('error', 'not_allowed'); end if;
  select checkpoints into v_cp from pft_races where id = g.race_id;
  for e in select u.uid, en as ent, coalesce(nullif(p.display_name, ''), 'Athlete') as name
             from unnest(coalesce(p_user_ids, '{}'::uuid[])) u(uid)
             left join pft_race_entries en on en.race_id = g.race_id and en.user_id = u.uid
             left join profiles p on p.id = u.uid loop
    if (e.ent).id is null then
      v_res := v_res || jsonb_build_object('user_id', e.uid, 'name', e.name, 'error', 'not_joined');
      continue;
    end if;
    if _pft_entry_state(e.ent, v_cp) <> 'waiting' and not coalesce(p_include_started, false) then
      v_res := v_res || jsonb_build_object('user_id', e.uid, 'name', e.name, 'error', 'already_started');
      continue;
    end if;
    j := pft_race_staff_remove(g.race_id, (e.ent).id);
    v_res := v_res || (jsonb_build_object('user_id', e.uid, 'name', e.name)
              || case when j ? 'error' then jsonb_build_object('error', j->>'error')
                      else jsonb_build_object('ok', true) end);
  end loop;
  return jsonb_build_object('ok', true, 'results', v_res);
end; $$;
grant execute on function public.mcp_timing_race_remove(text, text, uuid[], boolean) to anon, authenticated;

-- ---------- MCP: 출발 조(웨이브) ------------------------------------------------------
-- wave = 1~50 이면 그 조로, null 이면 조 해제. 출발한 선수는 건너뛴다(웹과 같음). note 를 주면 조 설명도 적는다.
create or replace function public.mcp_timing_race_set_wave(p_token text, p_code text, p_user_ids uuid[],
                                                          p_wave smallint default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; v_ids uuid[]; v_started jsonb; v_missing jsonb; j jsonb; n jsonb;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  select array_agg(e.id) into v_ids from pft_race_entries e
   where e.race_id = g.race_id and e.user_id = any(coalesce(p_user_ids, '{}'::uuid[]));
  select coalesce(jsonb_agg(u), '[]'::jsonb) into v_missing from unnest(coalesce(p_user_ids, '{}'::uuid[])) u
   where not exists (select 1 from pft_race_entries e where e.race_id = g.race_id and e.user_id = u);
  select coalesce(jsonb_agg(coalesce(nullif(p.display_name, ''), 'Athlete')), '[]'::jsonb) into v_started
    from pft_race_entries e join profiles p on p.id = e.user_id
   where e.id = any(coalesce(v_ids, '{}'::uuid[])) and e.started_at is not null;
  begin
    j := pft_race_set_wave(g.race_id, coalesce(v_ids, '{}'::uuid[]), p_wave);
    if j ? 'error' then raise exception using message = j->>'error'; end if;
    if p_note is not null and p_wave is not null then
      n := pft_race_set_wave_note(g.race_id, p_wave, p_note);
      if n ? 'error' then raise exception using message = n->>'error'; end if;
    end if;
  exception when raise_exception then
    return jsonb_build_object('error', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'wave', p_wave, 'updated', j->'updated',
                            'skipped_started', v_started, 'not_joined', v_missing,
                            'note', case when n is null then null else n->'note' end);
end; $$;
grant execute on function public.mcp_timing_race_set_wave(text, text, uuid[], smallint, text) to anon, authenticated;

create or replace function public.mcp_timing_race_wave_note(p_token text, p_code text, p_wave smallint, p_note text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  return pft_race_set_wave_note(g.race_id, p_wave, p_note);
end; $$;
grant execute on function public.mcp_timing_race_wave_note(text, text, smallint, text) to anon, authenticated;

-- ---------- MCP: 출발 · 선수 조작 -----------------------------------------------------
-- 조(wave)를 주면 그 조의 대기 선수 전부, user_ids 를 주면 그 사람들만(둘 다면 그 조 안의 그 사람들).
-- 시뮬 레이스는 조가 없는 선수를 출발시키지 않는다(웹 규칙과 같음 — skipped_no_wave).
create or replace function public.mcp_timing_race_start(p_token text, p_code text,
                                                       p_wave smallint default null, p_user_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; r record; v_ids uuid[]; v_nowave jsonb; j jsonb;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  if p_wave is null and coalesce(cardinality(p_user_ids), 0) = 0 then
    return jsonb_build_object('error', 'wave_or_users_required');
  end if;
  select * into r from pft_races where id = g.race_id;
  select array_agg(e.id) into v_ids from pft_race_entries e
   where e.race_id = r.id and e.started_at is null and cardinality(e.splits) = 0 and e.finished_at is null
     and (p_wave is null or e.wave = p_wave)
     and (p_user_ids is null or e.user_id = any(p_user_ids))
     and (r.format <> 'hyrox_sim' or e.wave is not null);
  select coalesce(jsonb_agg(coalesce(nullif(p.display_name, ''), 'Athlete')), '[]'::jsonb) into v_nowave
    from pft_race_entries e join profiles p on p.id = e.user_id
   where r.format = 'hyrox_sim' and e.race_id = r.id and e.wave is null and e.started_at is null
     and p_user_ids is not null and e.user_id = any(p_user_ids);
  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('error', 'nobody_to_start', 'skipped_no_wave', v_nowave);
  end if;
  j := pft_race_staff_start(r.id, v_ids);
  if j ? 'error' then return j; end if;
  return j || jsonb_build_object('skipped_no_wave', v_nowave,
    'names', (select jsonb_agg(coalesce(nullif(p.display_name, ''), 'Athlete'))
                from pft_race_entries e join profiles p on p.id = e.user_id where e.id = any(v_ids)));
end; $$;
grant execute on function public.mcp_timing_race_start(text, text, smallint, uuid[]) to anon, authenticated;

-- 선수 한 명 조작: pause / resume / dnf / undo_dnf / reset(기록을 지우고 출발 전으로)
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
         else jsonb_build_object('error', 'invalid_action') end;
  return j;
end; $$;
grant execute on function public.mcp_timing_race_entry(text, text, uuid, text) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 운영진 토큰으로 만들기→고치기→참가자→조→출발→조작을 돌려 보고 예외로 되감는다.
do $$
declare
  v_crew uuid; v_slug text; v_staff uuid; v_m1 uuid; v_m2 uuid; v_out uuid; j jsonb; v_code text;
  k text := 'guard-race-mcp-staff-token-0000000000001';
  k_out text := 'guard-race-mcp-outsider-token-00000000002';
begin
  if has_function_privilege('anon', 'public._mcp_act_as(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._mcp_act_as(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._mcp_race_gate(text, text, boolean)', 'execute') then
    raise exception '가드: 가장 헬퍼가 클라이언트에 열려 있습니다';
  end if;
  if has_function_privilege('anon', 'public.pft_race_update(uuid, text, text, boolean, integer)', 'execute') then
    raise exception '가드: 레이스 수정이 익명 실행 가능합니다';
  end if;

  select m.crew_id, c.slug, m.user_id into v_crew, v_slug, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner', 'coach')
     and (select count(*) from crew_members x where x.crew_id = m.crew_id and x.status = 'active') >= 3
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 크루 없음'; return; end if;
  select m.user_id into v_m1 from crew_members m join profiles p on p.id = m.user_id and not p.disabled
   where m.crew_id = v_crew and m.status = 'active' and m.user_id <> v_staff order by m.user_id limit 1;
  select m.user_id into v_m2 from crew_members m join profiles p on p.id = m.user_id and not p.disabled
   where m.crew_id = v_crew and m.status = 'active' and m.user_id not in (v_staff, v_m1) order by m.user_id limit 1;
  select p.id into v_out from profiles p
   where not p.disabled and not coalesce(p.is_admin, false)
     and not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id) limit 1;

  begin
    perform set_config('rox.profile_bypass', '1', true);
    update profiles set mcp_token = k, mcp_write = true where id = v_staff;

    j := mcp_timing_race_create(k, '가드 시뮬', v_slug, 'hyrox_sim', 16, false, '  10:00 집합  ');
    if j ? 'error' or j->'race'->>'description' <> '10:00 집합' or (j->'race'->>'checkpoints')::int <> 16
       or (j->>'can_manage')::boolean is not true then
      raise exception '가드: 만들기 %', j;
    end if;
    v_code := j->'race'->>'code';

    -- 고치기: 제목·설명·구간·코드참가 한 번에, 실패하면 전부 되돌림
    j := mcp_timing_race_update(k, v_code, p_title => '가드 시뮬 2', p_checkpoints => 24, p_join_open => true);
    if j ? 'error' or j->'race'->>'title' <> '가드 시뮬 2' or (j->'race'->>'checkpoints')::int <> 24
       or (j->'race'->>'join_open')::boolean is not true then
      raise exception '가드: 고치기 %', j;
    end if;
    j := mcp_timing_race_update(k, v_code, p_title => '되돌려져야 함', p_checkpoints => 20);
    if j->>'error' is distinct from 'invalid_checkpoints'
       or (select title from pft_races where code = v_code) <> '가드 시뮬 2' then
      raise exception '가드: 고치기 원자성 %', j;
    end if;

    -- 참가자: 크루 밖 사람은 거부, 크루원 둘 추가
    j := mcp_timing_race_add(k, v_code, array[v_m1, v_m2, v_out]);
    if (select count(*) from pft_race_entries e join pft_races r on r.id = e.race_id where r.code = v_code) <> 2 then
      raise exception '가드: 참가자 추가 %', j;
    end if;
    if v_out is not null and not exists (select 1 from jsonb_array_elements(j->'results') x
                                          where x->>'error' = 'not_a_member') then
      raise exception '가드: 크루 밖 사람 추가됨 %', j;
    end if;
    j := mcp_timing_race_members(k, v_code, null);
    if jsonb_typeof(j) <> 'array' or jsonb_array_length(j) < 3 then raise exception '가드: 후보 목록 %', j; end if;

    -- 조: 시뮬은 조 없이 출발 불가 → 조 배정 + 설명 → 조 출발
    j := mcp_timing_race_start(k, v_code, p_user_ids => array[v_m1]);
    if j->>'error' is distinct from 'nobody_to_start' then raise exception '가드: 조 없이 출발 %', j; end if;
    j := mcp_timing_race_set_wave(k, v_code, array[v_m1, v_m2], 1::smallint, '1조 남자');
    if j ? 'error' or (j->>'updated')::int <> 2 or j->>'note' <> '1조 남자' then raise exception '가드: 조 배정 %', j; end if;
    j := mcp_timing_race_set_wave(k, v_code, array[v_m2], null);
    if (select wave from pft_race_entries e join pft_races r on r.id = e.race_id
         where r.code = v_code and e.user_id = v_m2) is not null then
      raise exception '가드: 조 해제 %', j;
    end if;
    j := mcp_timing_race_start(k, v_code, p_wave => 1::smallint);
    if j ? 'error' or (j->>'started')::int <> 1 then raise exception '가드: 조 출발 %', j; end if;

    -- 출발 뒤에는 구간 수를 못 바꾸고, 출발한 사람은 기본으로 못 뺀다
    j := mcp_timing_race_update(k, v_code, p_checkpoints => 32);
    if j->>'error' is distinct from 'race_started' then raise exception '가드: 출발 후 구간 변경 %', j; end if;
    j := mcp_timing_race_remove(k, v_code, array[v_m1]);
    if j->'results'->0->>'error' is distinct from 'already_started' then raise exception '가드: 출발자 빼기 %', j; end if;
    j := mcp_timing_race_remove(k, v_code, array[v_m2]);
    if (j->'results'->0->>'ok')::boolean is not true then raise exception '가드: 대기자 빼기 %', j; end if;

    -- 선수 조작
    j := mcp_timing_race_entry(k, v_code, v_m1, 'pause');
    if j->>'paused_at' is null then raise exception '가드: 일시정지 %', j; end if;
    j := mcp_timing_race_entry(k, v_code, v_m1, 'resume');
    j := mcp_timing_race_entry(k, v_code, v_m1, 'dnf');
    j := mcp_timing_race_get(k, v_code);
    if j->'entries'->0->>'state' <> 'dnf' then raise exception '가드: 상세 상태 %', j; end if;
    j := mcp_timing_race_entry(k, v_code, v_m1, 'nope');
    if j->>'error' is distinct from 'invalid_action' then raise exception '가드: 잘못된 동작 %', j; end if;

    -- 종료 / 목록
    j := mcp_timing_race_update(k, v_code, p_status => 'closed');
    if j->'race'->>'status' <> 'closed' then raise exception '가드: 종료 %', j; end if;
    j := mcp_timing_races(k, v_slug, true);
    if not exists (select 1 from jsonb_array_elements(j) x where x->>'code' = v_code and (x->>'can_manage')::boolean) then
      raise exception '가드: 목록 %', j;
    end if;

    -- 읽기 전용 토큰 · 권한 없는 사람
    update profiles set mcp_write = false where id = v_staff;
    j := mcp_timing_race_update(k, v_code, p_title => 'x');
    if j->>'error' is distinct from 'read_only_token' then raise exception '가드: 읽기 전용 %', j; end if;
    if v_out is not null then
      update profiles set mcp_token = k_out, mcp_write = true where id = v_out;
      j := mcp_timing_race_update(k_out, v_code, p_title => 'x');
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 권한 없는 수정 %', j; end if;
    end if;
    if mcp_timing_races('guard-invalid-token-000000000000000000', null, false) is not null then
      raise exception '가드: 무효 토큰';
    end if;

    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('rox.profile_bypass', '', true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('rox.profile_bypass', '', true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
