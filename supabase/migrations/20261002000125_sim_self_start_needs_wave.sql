-- ============================================================
-- Roxlogy — 시뮬 타임체크: 조 배정 없이 본인 출발 불가 (2026-10-02)
--
-- 스태프 화면은 조 카드에서만 출발시킨다(조 없이 출발 불가). 선수 본인 출발(pft_race_start)도
-- 같은 규칙으로 — 시뮬 타임체크(hyrox_sim) 레이스에서 조가 없으면 no_wave 로 거부한다.
-- PFT 레이스는 혼자 재는 측정이라 예전처럼 본인 출발을 허용한다.
-- 선수 화면이 조 유무를 알 수 있게 내 기록 JSON(_pft_entry_json)에 wave 를 덧붙인다(키 추가만).
-- 화면(components/pft-race-runner.tsx)은 이 마이그레이션보다 먼저 배포됐다.
-- 되돌리기: 마이그레이션 124 의 _pft_entry_json · pft_race_start 정의를 다시 적용.
-- ============================================================

create or replace function public._pft_entry_json(p_entry uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'entry_id', e.id, 'race_id', e.race_id, 'started_at', e.started_at,
    'splits', to_jsonb(e.splits), 'finished_at', e.finished_at, 'total_ms', e.total_ms,
    'scaled', e.scaled, 'result_id', e.result_id, 'dnf_at', e.dnf_at, 'status', r.status,
    'session_id', e.session_id,
    'paused_at', e.paused_at, 'paused_ms', e.paused_ms,
    'wave', e.wave)
  from pft_race_entries e join pft_races r on r.id = e.race_id where e.id = p_entry;
$$;

create or replace function public.pft_race_start(p_race uuid, p_scaled boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); rec record;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select en.*, r.status, r.format as race_format into rec
    from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.race_id = p_race and en.user_id = v_uid;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished'); end if;
  if cardinality(rec.splits) > 0 then return jsonb_build_object('error', 'already_started'); end if;
  -- 시뮬 타임체크는 조가 정해진 선수만 출발한다
  if rec.race_format = 'hyrox_sim' and rec.wave is null then
    return jsonb_build_object('error', 'no_wave');
  end if;
  update pft_race_entries set started_at = now(), scaled = coalesce(p_scaled, false),
         paused_at = null, paused_ms = 0, updated_at = now()
   where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
grant execute on function public.pft_race_start(uuid, boolean) to authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 시뮬 레이스의 대기 선수 하나로: 조 없으면 no_wave, 조를 주면 출발 — 확인 후 되감는다.
do $$
declare v_entry uuid; v_race uuid; v_user uuid; j jsonb;
begin
  select e.id, e.race_id, e.user_id into v_entry, v_race, v_user
    from pft_race_entries e join pft_races r on r.id = e.race_id
   where r.format = 'hyrox_sim' order by e.joined_at desc limit 1;
  if v_entry is null then raise notice '가드 건너뜀: 시뮬 참가 기록 없음'; return; end if;

  begin
    update pft_races set status = 'open' where id = v_race;
    update pft_race_entries
       set started_at = null, splits = '{}', finished_at = null, total_ms = null,
           dnf_at = null, paused_at = null, paused_ms = 0, wave = null
     where id = v_entry;
    perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

    j := pft_race_start(v_race, false);
    if j->>'error' is distinct from 'no_wave' then raise exception '가드: 조 없이 본인 출발됨 %', j; end if;

    update pft_race_entries set wave = 1 where id = v_entry;
    j := pft_race_start(v_race, false);
    if j ? 'error' or j->>'started_at' is null or (j->>'wave')::int <> 1 then
      raise exception '가드: 조 배정 뒤 본인 출발 실패 %', j;
    end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
