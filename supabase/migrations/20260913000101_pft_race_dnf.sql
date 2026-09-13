-- ============================================================
-- Roxlogy — PFT 레이스 중도포기(DNF)
--
-- 지금까지 DNF 는 "레이스가 종료됐는데 완주 기록이 없다"로 **유추**할 뿐이었다.
-- 진행 중에 그만둔 사람을 표시할 방법이 없어서, 보드에서 경과 시계가 계속 흘렀고
-- 스태프 화면에도 여전히 "다음 종목 완료" 버튼이 떠 있었다 (2026-09-13 운영 피드백).
--
-- entries.dnf_at 으로 명시한다. 규칙:
--  · 출발한 사람만 중도포기할 수 있다(출발 전이면 그냥 빼면 된다 — staff_remove).
--  · 완주한 사람은 안 된다. 완주를 먼저 취소(undo)해야 한다.
--  · 해제하면 그대로 다시 측정 중으로 돌아간다(스플릿은 건드리지 않는다).
--  · 초기화(reset)는 dnf_at 도 함께 지운다 — 처음부터 다시 뛰는 것이므로.
-- ============================================================

alter table public.pft_race_entries
  add column if not exists dnf_at timestamptz;

comment on column public.pft_race_entries.dnf_at is
  'PFT 레이스 중도포기 시각. null = 포기 아님. 출발했고 완주하지 않은 사람만 설정된다.';

-- 엔트리 응답에 dnf_at 추가 (덧붙이기만 — 옛 번들은 무시하고 지나간다)
create or replace function public._pft_entry_json(p_entry uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'entry_id', e.id, 'race_id', e.race_id, 'started_at', e.started_at,
    'splits', to_jsonb(e.splits), 'finished_at', e.finished_at, 'total_ms', e.total_ms,
    'scaled', e.scaled, 'result_id', e.result_id, 'dnf_at', e.dnf_at, 'status', r.status)
  from pft_race_entries e join pft_races r on r.id = e.race_id where e.id = p_entry;
$$;

-- 내부 적용 — 자가·스태프 경로가 같이 쓴다(가드를 한 곳에 둔다)
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
    update pft_race_entries set dnf_at = now(), updated_at = now() where id = rec.id;
  else
    update pft_race_entries set dnf_at = null, updated_at = now() where id = rec.id;
  end if;

  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public._pft_apply_dnf(uuid, boolean) from public, anon, authenticated;

-- 자가 중도포기 (참가자 본인 폰)
create or replace function public.pft_race_dnf(p_race uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_entry uuid;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select id into v_entry from pft_race_entries where race_id = p_race and user_id = v_uid;
  if v_entry is null then return jsonb_build_object('error', 'not_joined'); end if;
  return _pft_apply_dnf(v_entry, p_on);
end; $$;
grant execute on function public.pft_race_dnf(uuid, boolean) to anon, authenticated;

-- 운영진이 대신 표시
create or replace function public.pft_race_staff_dnf(p_race uuid, p_entry uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  if not exists (select 1 from pft_race_entries where id = p_entry and race_id = p_race) then
    return jsonb_build_object('error', 'not_joined');
  end if;
  return _pft_apply_dnf(p_entry, p_on);
end; $$;
grant execute on function public.pft_race_staff_dnf(uuid, uuid, boolean) to anon, authenticated;

-- 초기화는 중도포기도 함께 지운다 — 처음부터 다시 뛰는 것이므로
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
     set started_at = null, splits = '{}', dnf_at = null, updated_at = now()
   where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;

-- 보드 응답에 dnf_at 추가
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

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_race uuid; v_owner uuid; v_entry uuid; v_res jsonb; v_dnf timestamptz;
begin
  select r.id, r.created_by into v_race, v_owner
    from pft_races r where r.status <> 'closed' order by r.created_at desc limit 1;
  if v_race is null then raise notice '가드 건너뜀: 진행 중 레이스 없음'; return; end if;
  select e.id into v_entry from pft_race_entries e where e.race_id = v_race limit 1;
  if v_entry is null then raise notice '가드 건너뜀: 엔트리 없음'; return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  -- 출발 전에는 중도포기할 수 없다
  update pft_race_entries set started_at = null, finished_at = null, dnf_at = null where id = v_entry;
  select pft_race_staff_dnf(v_race, v_entry, true) into v_res;
  if v_res->>'error' is distinct from 'not_started' then
    raise exception '가드: 출발 전인데 중도포기가 됐다 (%)', v_res;
  end if;

  -- 출발한 사람은 된다
  update pft_race_entries set started_at = now() where id = v_entry;
  perform pft_race_staff_dnf(v_race, v_entry, true);
  select dnf_at into v_dnf from pft_race_entries where id = v_entry;
  if v_dnf is null then raise exception '가드: 중도포기가 기록되지 않았다'; end if;

  -- 해제된다
  perform pft_race_staff_dnf(v_race, v_entry, false);
  select dnf_at into v_dnf from pft_race_entries where id = v_entry;
  if v_dnf is not null then raise exception '가드: 중도포기 해제가 안 됐다'; end if;

  -- 초기화가 중도포기도 지운다
  perform pft_race_staff_dnf(v_race, v_entry, true);
  perform _pft_apply_reset(v_entry);
  select dnf_at into v_dnf from pft_race_entries where id = v_entry;
  if v_dnf is not null then raise exception '가드: reset 이 dnf_at 을 남겼다'; end if;

  -- 남은 못 바꾼다
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  select pft_race_staff_dnf(v_race, v_entry, true) into v_res;
  if v_res->>'error' is distinct from 'not_allowed' then
    raise exception '가드: 남이 중도포기를 표시할 수 있다 (%)', v_res;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
