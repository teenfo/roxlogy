-- ============================================================
-- Roxlogy — PFT 레이스 출발 웨이브(조)
--
-- 지금까지 "웨이브 출발"은 스태프가 그때그때 사람을 골라 한꺼번에 출발시키는 것뿐이었다.
-- 저장되는 조 편성이 없어서, 현장에서 조를 미리 짜 두고 순서대로 내보낼 수가 없었다
-- (2026-09-13 실제 운영 피드백).
--
-- entries.wave 로 조를 저장한다. null = 미배정.
-- 출발 자체는 기존 pft_race_staff_start(p_race, p_entries) 를 그대로 쓴다 —
-- 그 조의 대기자 id 를 넘기면 서버 now() 한 값으로 같이 출발한다. 새 출발 경로를
-- 만들지 않는 이유: 종료 가드·권한 검사가 이미 그 함수 한 곳에 모여 있다.
-- ============================================================

alter table public.pft_race_entries
  add column if not exists wave smallint
  check (wave is null or (wave between 1 and 50));

comment on column public.pft_race_entries.wave is
  'PFT 레이스 출발 조. null = 미배정. 출발은 pft_race_staff_start 가 담당한다.';

-- 보드·스태프 화면이 조별로 묶어 보여 준다
create index if not exists idx_pft_entries_race_wave
  on public.pft_race_entries(race_id, wave);

-- 조 배정 — 운영진만. p_wave 가 null 이면 배정을 푼다.
create or replace function public.pft_race_set_wave(
  p_race uuid, p_entries uuid[], p_wave smallint
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  if exists (select 1 from pft_races where id = p_race and status = 'closed') then
    return jsonb_build_object('error', 'race_closed');
  end if;
  if p_wave is not null and (p_wave < 1 or p_wave > 50) then
    return jsonb_build_object('error', 'bad_wave');
  end if;

  -- 이미 출발한 사람의 조는 바꾸지 않는다 — 기록이 붙은 뒤 조를 옮기면
  -- 화면에서 같은 조가 서로 다른 시각에 출발한 것처럼 보인다.
  update pft_race_entries
     set wave = p_wave, updated_at = now()
   where race_id = p_race and id = any(p_entries) and started_at is null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'updated', v_n, 'wave', p_wave);
end; $$;

grant execute on function public.pft_race_set_wave(uuid, uuid[], smallint)
  to anon, authenticated;

-- 보드 응답에 wave 추가 (덧붙이기만 — 옛 번들은 무시하고 지나간다).
-- 정렬은 참가 순서(joined_at) 그대로다: 스태프 화면은 카드가 움직이면 누가 어디 있었는지
-- 놓치기 때문에 순서를 고정해 뒀다(2026-09-12). 조별 묶음은 화면에서 한다.
create or replace function public.pft_race_board(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'code', r.code, 'title', r.title, 'status', r.status,
                               'crew', c.name, 'crew_slug', c.slug, 'created_at', r.created_at,
                               'join_open', r.join_open),
    'server_now', now(),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', e.id, 'user_id', e.user_id,
        'name', coalesce(nullif(p.display_name, ''), 'Athlete'),
        'started_at', e.started_at, 'splits', to_jsonb(e.splits),
        'finished_at', e.finished_at, 'total_ms', e.total_ms, 'scaled', e.scaled,
        'wave', e.wave,
        'badge', res.badge) order by e.joined_at)
      from pft_race_entries e
      join profiles p on p.id = e.user_id
      left join pft_results res on res.id = e.result_id
      where e.race_id = r.id), '[]'::jsonb))
  from pft_races r left join crews c on c.id = r.crew_id
  where r.code = upper(trim(coalesce(p_code, '')));
$$;

grant execute on function public.pft_race_board(text) to anon, authenticated;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_race uuid; v_owner uuid; v_entry uuid; v_wave smallint; v_res jsonb;
begin
  select r.id, r.created_by into v_race, v_owner
    from pft_races r where r.status <> 'closed' order by r.created_at desc limit 1;
  if v_race is null then raise notice '가드 건너뜀: 진행 중 레이스 없음'; return; end if;

  select e.id into v_entry from pft_race_entries e
   where e.race_id = v_race and e.started_at is null limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  -- 보드에 wave 키가 실린다
  select pft_race_board((select code from pft_races where id = v_race)) into v_res;
  if v_res->'entries'->0 is not null
     and not (v_res->'entries'->0 ? 'wave') then
    raise exception '가드: 보드 응답에 wave 가 없다';
  end if;

  if v_entry is not null then
    perform pft_race_set_wave(v_race, array[v_entry], 2::smallint);
    select wave into v_wave from pft_race_entries where id = v_entry;
    if v_wave <> 2 then raise exception '가드: 조 배정이 안 됐다 (%)', v_wave; end if;

    -- 해제도 되는지
    perform pft_race_set_wave(v_race, array[v_entry], null);
    select wave into v_wave from pft_race_entries where id = v_entry;
    if v_wave is not null then raise exception '가드: 조 해제가 안 됐다 (%)', v_wave; end if;
  end if;

  -- 남은 이 레이스를 관리할 수 없는 사람은 거부된다
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  select pft_race_set_wave(v_race, array[coalesce(v_entry, gen_random_uuid())], 1::smallint) into v_res;
  if v_res->>'error' is distinct from 'not_allowed' then
    raise exception '가드: 남이 조를 바꿀 수 있다 (%)', v_res;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
