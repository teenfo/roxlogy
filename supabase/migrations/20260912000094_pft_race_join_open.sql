-- ============================================================
-- Roxlogy — PFT 레이스: "참가 코드로 참가" / "코드 없이(운영진이 추가)" 두 갈래
--
-- 레이스를 만들 때 고른다:
--   · join_open = true (기본) — 6자리 코드를 공개하고 참가자가 코드로 스스로 참가한다.
--   · join_open = false        — 코드를 화면에 보여 주지 않고 자가 참가를 막는다.
--                                운영진이 스태프 타이밍에서 참가자를 직접 추가한다(093).
-- 코드 자체는 항상 발급한다 — /pft/race/<코드> · /board/<코드> 의 URL 키이기 때문.
-- 코드 없는 레이스에서 코드는 "주소"일 뿐이고, 참가 판정은 서버가 join_open 으로 막는다.
--
-- 함께: 이미 참가한 사람에게는 코드를 다시 묻지 않는다(화면 쪽 규칙) — 보드·참가자 화면은
-- 엔트리가 있으면 코드 블록 대신 "내 측정 화면"으로 안내한다.
-- ============================================================

alter table public.pft_races
  add column if not exists join_open boolean not null default true;

comment on column public.pft_races.join_open is
  '참가 코드로 자가 참가를 허용할지. false 면 코드를 공개하지 않고 운영진이 참가자를 추가한다.';

-- ---------- 생성: 참가 방식 선택 ------------------------------------------------
-- 인자 목록이 바뀌므로 drop + create (create or replace 로는 인자를 늘릴 수 없다).
drop function if exists public.pft_race_create(text, text);
create function public.pft_race_create(
  p_title text,
  p_crew_slug text default null,
  p_join_open boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_crew uuid; v_code text; v_id uuid; i int;
  v_title text := trim(coalesce(p_title, ''));
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_open boolean := coalesce(p_join_open, true);
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    return jsonb_build_object('error', 'invalid_title');
  end if;
  if p_crew_slug is not null and p_crew_slug <> '' then
    select id into v_crew from crews where slug = p_crew_slug and status = 'active';
    if v_crew is null then return jsonb_build_object('error', 'crew_not_found'); end if;
    if not (is_admin() or is_crew_staff(v_crew)) then
      return jsonb_build_object('error', 'not_allowed');
    end if;
  elsif not is_admin() then
    return jsonb_build_object('error', 'not_allowed',
      'hint', '전체 관리자이거나, 크루 운영진이면 crew_slug 를 지정하세요.');
  end if;
  -- 6자리 코드 — 헷갈리는 글자(0/O, 1/I) 제외. 충돌하면 다시 뽑는다.
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from pft_races where code = v_code);
  end loop;
  insert into pft_races (code, title, crew_id, created_by, join_open)
  values (v_code, v_title, v_crew, v_uid, v_open) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'join_open', v_open);
end; $$;
revoke all on function public.pft_race_create(text, text, boolean) from public;
grant execute on function public.pft_race_create(text, text, boolean) to authenticated;

-- ---------- 운영진: 참가 방식 바꾸기 --------------------------------------------
-- 코드 없이 연 레이스에 뒤늦게 자가 참가를 열어 줄 수 있어야 막다른 길이 되지 않는다.
create or replace function public.pft_race_set_join_open(p_race uuid, p_open boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  update pft_races set join_open = coalesce(p_open, true) where id = p_race returning code into v_code;
  if v_code is null then return jsonb_build_object('error', 'race_not_found'); end if;
  return jsonb_build_object('ok', true, 'join_open', coalesce(p_open, true), 'code', v_code);
end; $$;
revoke all on function public.pft_race_set_join_open(uuid, boolean) from public;
grant execute on function public.pft_race_set_join_open(uuid, boolean) to authenticated;

-- ---------- 참가: 코드 없는 레이스는 자가 참가 불가 ---------------------------------
create or replace function public.pft_race_join(p_code text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); r record; v_entry uuid;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if not exists (select 1 from profiles where id = v_uid and not disabled) then
    raise exception 'account_disabled' using errcode = '42501';
  end if;
  select * into r from pft_races where code = upper(trim(coalesce(p_code, '')));
  if r.id is null then return jsonb_build_object('error', 'race_not_found'); end if;
  if r.status = 'closed' then return jsonb_build_object('error', 'race_closed', 'code', r.code); end if;
  -- 이미 참가한 사람은 그대로 통과시킨다 — 코드를 다시 묻지 않기 위해서다.
  select id into v_entry from pft_race_entries where race_id = r.id and user_id = v_uid;
  if v_entry is null and not r.join_open then
    return jsonb_build_object('error', 'join_closed', 'code', r.code);
  end if;
  insert into pft_race_entries (race_id, user_id) values (r.id, v_uid)
  on conflict (race_id, user_id) do update set updated_at = now()
  returning id into v_entry;
  return jsonb_build_object('ok', true, 'race_id', r.id, 'code', r.code, 'entry_id', v_entry);
end; $$;
revoke all on function public.pft_race_join(text) from public;
grant execute on function public.pft_race_join(text) to authenticated;

-- ---------- 보드: 참가 방식을 함께 내려준다 ---------------------------------------
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
        'badge', res.badge) order by e.joined_at)
      from pft_race_entries e
      join profiles p on p.id = e.user_id
      left join pft_results res on res.id = e.result_id
      where e.race_id = r.id), '[]'::jsonb))
  from pft_races r left join crews c on c.id = r.crew_id
  where r.code = upper(trim(coalesce(p_code, '')));
$$;
revoke all on function public.pft_race_board(text) from public;
grant execute on function public.pft_race_board(text) to anon, authenticated;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_user uuid; j jsonb; v_race uuid; v_code text;
begin
  select id into v_admin from public.profiles where is_admin and not disabled limit 1;
  select id into v_user from public.profiles where not is_admin and not disabled limit 1;
  if v_admin is null or v_user is null then raise notice '가드 건너뜀: 계정 부족'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  -- 1) 코드 없이 만든 레이스 — 자가 참가 거부
  j := public.pft_race_create('코드 없는 가드', null, false);
  if (j->>'join_open')::boolean is distinct from false then raise exception '가드: 생성 옵션 무시 %', j; end if;
  v_race := (j->>'id')::uuid; v_code := j->>'code';
  j := public.pft_race_board(v_code);
  if (j->'race'->>'join_open')::boolean is distinct from false then raise exception '가드: 보드 join_open 이상 %', j; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  if (public.pft_race_join(v_code))->>'error' is distinct from 'join_closed' then
    raise exception '가드: 코드 없는 레이스에 자가 참가했다'; end if;
  -- 2) 운영진이 추가한 사람은 join 이 통과해야 한다(코드를 다시 묻지 않기 위해)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_staff_add(v_race, v_user);
  if j->>'entry_id' is null then raise exception '가드: 스태프 등록 실패 %', j; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  if (public.pft_race_join(v_code))->>'ok' is distinct from 'true' then
    raise exception '가드: 이미 참가한 사람이 막혔다'; end if;
  -- 3) 운영진이 자가 참가를 열면 통과
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_set_join_open(v_race, true);
  if j->>'ok' is distinct from 'true' then raise exception '가드: 참가 열기 실패 %', j; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  if (public.pft_race_set_join_open(v_race, false))->>'error' is distinct from 'not_allowed' then
    raise exception '가드: 비운영진이 참가 방식을 바꿨다'; end if;
  if (public.pft_race_join(v_code))->>'ok' is distinct from 'true' then
    raise exception '가드: 열린 뒤에도 참가가 막혔다'; end if;
  -- 4) 기본 생성은 코드 참가
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_create('코드 가드');
  if (j->>'join_open')::boolean is distinct from true then raise exception '가드: 기본값이 코드 참가가 아니다 %', j; end if;

  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
