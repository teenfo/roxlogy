-- ============================================================
-- Roxlogy — 레이스 조(웨이브)별 설명 (2026-10-03)
--
-- 스태프 화면의 조 카드마다 설명을 한 줄(선택, 120자) 적어 둔다 — 예: "10:30 출발 · 남자 오픈".
-- 조 자체는 pft_race_entries.wave 숫자일 뿐이라, 설명만 (race_id, wave) 로 따로 둔다.
--   pft_race_waves — RLS 켜고 정책 없음(직접 접근 차단), 읽기는 pft_race_board, 쓰기는 RPC
--   pft_race_set_wave_note(race, wave, note) — 레이스 운영진만(pft_race_can_manage). 빈 값이면 지운다
-- pft_race_board 에는 'waves' 키를 덧붙이기만 한다 — 옛 화면은 무시한다.
-- 되돌리기: 함수 pft_race_set_wave_note 와 테이블 pft_race_waves 를 없애고 124 의 pft_race_board 재적용.
-- ============================================================

create table if not exists public.pft_race_waves (
  race_id    uuid not null references public.pft_races(id) on delete cascade,
  wave       smallint not null check (wave between 1 and 50),
  note       text not null check (char_length(btrim(note)) between 1 and 120),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (race_id, wave)
);
create index if not exists pft_race_waves_updated_by_idx on public.pft_race_waves(updated_by);
alter table public.pft_race_waves enable row level security;

create or replace function public.pft_race_set_wave_note(p_race uuid, p_wave smallint, p_note text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_note text := btrim(coalesce(p_note, ''));
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_wave is null or p_wave < 1 or p_wave > 50 then return jsonb_build_object('error', 'bad_wave'); end if;
  if char_length(v_note) > 120 then return jsonb_build_object('error', 'note_too_long'); end if;
  if v_note = '' then
    delete from pft_race_waves where race_id = p_race and wave = p_wave;
  else
    insert into pft_race_waves (race_id, wave, note, updated_by)
    values (p_race, p_wave, v_note, auth.uid())
    on conflict (race_id, wave) do update
      set note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'wave', p_wave, 'note', nullif(v_note, ''));
end; $$;
grant execute on function public.pft_race_set_wave_note(uuid, smallint, text) to authenticated;

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
      where e.race_id = r.id), '[]'::jsonb),
    'waves', coalesce((
      select jsonb_agg(jsonb_build_object('wave', w.wave, 'note', w.note) order by w.wave)
      from pft_race_waves w where w.race_id = r.id), '[]'::jsonb))
  from pft_races r left join crews c on c.id = r.crew_id
  where r.code = upper(trim(coalesce(p_code, '')));
$$;
grant execute on function public.pft_race_board(text) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 레이스 운영진은 쓰고·고치고·지우고, 크루 밖 사람은 못 쓴다. 보드에 실린다 — 확인 후 되감는다.
do $$
declare v_race uuid; v_code text; v_mgr uuid; v_out uuid; j jsonb;
begin
  if has_function_privilege('anon', 'public.pft_race_set_wave_note(uuid, smallint, text)', 'execute') then
    raise exception '가드: 조 설명 쓰기가 익명 실행 가능합니다';
  end if;
  select r.id, r.code, r.created_by into v_race, v_code, v_mgr
    from pft_races r where r.created_by is not null order by r.created_at desc limit 1;
  if v_race is null then raise notice '가드 건너뜀: 레이스 없음'; return; end if;
  select p.id into v_out from profiles p
   where p.id <> v_mgr and not coalesce(p.is_admin, false)
     and not exists (select 1 from pft_races r join crew_members m on m.crew_id = r.crew_id
                      where r.id = v_race and m.user_id = p.id)
   limit 1;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr::text, 'role', 'authenticated')::text, true);
    j := pft_race_set_wave_note(v_race, 1::smallint, '  10:30 출발 · 남자 오픈  ');
    if j ? 'error' or j->>'note' <> '10:30 출발 · 남자 오픈' then raise exception '가드: 설명 쓰기 %', j; end if;
    j := pft_race_set_wave_note(v_race, 1::smallint, '10:40 출발');
    if (select note from pft_race_waves where race_id = v_race and wave = 1) <> '10:40 출발' then
      raise exception '가드: 설명 고치기 실패';
    end if;
    if not exists (select 1 from jsonb_array_elements(pft_race_board(v_code)->'waves') x
                    where (x->>'wave')::int = 1 and x->>'note' = '10:40 출발') then
      raise exception '가드: 보드에 조 설명이 없음';
    end if;
    j := pft_race_set_wave_note(v_race, 1::smallint, repeat('가', 121));
    if j->>'error' is distinct from 'note_too_long' then raise exception '가드: 120자 제한 %', j; end if;
    j := pft_race_set_wave_note(v_race, 1::smallint, '   ');
    if exists (select 1 from pft_race_waves where race_id = v_race and wave = 1) then
      raise exception '가드: 빈 설명이 지워지지 않음';
    end if;

    if v_out is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
      j := pft_race_set_wave_note(v_race, 2::smallint, 'x');
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 운영진 아닌 사람이 설명을 씀 %', j; end if;
    end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
