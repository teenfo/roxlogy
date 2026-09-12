-- ============================================================
-- Roxlogy — PFT 레이스 보드 (현장 측정 중계)
--
-- 흐름: 관리자(전체 관리자 또는 크루 운영진)가 레이스를 만들고 6자리 코드를 공유한다 →
--   참가자가 코드로 참가한다 → 참가자 폰(파트너가 눌러 줘도 됨)에서 시작·종목 완료를 찍으면
--   서버에 동기화된다 → 공개 보드(/board/<코드>)가 Realtime 으로 순위·진행을 중계한다.
--
-- 설계
--   · pft_races: 레이스(제목·코드·상태·크루 연결). pft_race_entries: 참가자 한 명의 진행 상태.
--   · 스플릿은 pft_results 와 같은 "시작 이후 누적 ms" 6개. 시각은 참가자 폰이 잰 경과(ms)를
--     그대로 받는다 — 폰 시계 오차와 오프라인 재전송에 강하고, 시작 시각만 서버 now() 로 찍는다.
--   · 6번째 스플릿이 찍히면 pft_results 행을 자동 생성해(회원 기록·리더보드·배지 반영) 연결한다.
--   · 읽기는 누구나(보드는 로그인 없이 본다), 쓰기는 전부 RPC — 본인 엔트리만, 관리자는 상태만.
--   · Realtime: pft_race_entries 를 supabase_realtime 게시에 올린다. 보드는 변경 이벤트를
--     "다시 읽으라는 신호"로만 쓰고 실제 데이터는 pft_race_board() 로 받는다(이름 해석 포함).
-- ============================================================

create table if not exists public.pft_races (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  title       text not null check (char_length(title) between 1 and 80),
  crew_id     uuid references public.crews(id) on delete set null,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists pft_races_created_idx on public.pft_races(created_at desc);
alter table public.pft_races enable row level security;
drop policy if exists pft_races_select on public.pft_races;
create policy pft_races_select on public.pft_races for select using (true);
grant select on public.pft_races to anon, authenticated;

create table if not exists public.pft_race_entries (
  id          uuid primary key default gen_random_uuid(),
  race_id     uuid not null references public.pft_races(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  started_at  timestamptz,
  splits      integer[] not null default '{}',
  finished_at timestamptz,
  total_ms    integer,
  scaled      boolean not null default false,
  result_id   uuid references public.pft_results(id) on delete set null,
  joined_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (race_id, user_id)
);
create index if not exists pft_race_entries_race_idx on public.pft_race_entries(race_id);
alter table public.pft_race_entries enable row level security;
drop policy if exists pft_race_entries_select on public.pft_race_entries;
create policy pft_race_entries_select on public.pft_race_entries for select using (true);
grant select on public.pft_race_entries to anon, authenticated;
-- Realtime: 보드가 변경 신호를 받는다. 필터(race_id=eq.)가 UPDATE/DELETE 에서도 먹게 full.
alter table public.pft_race_entries replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public'
                    and tablename = 'pft_race_entries') then
    alter publication supabase_realtime add table public.pft_race_entries;
  end if;
end $$;

-- ---------- 관리 권한 -----------------------------------------------------
create or replace function public.pft_race_can_manage(p_race uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from pft_races r
    where r.id = p_race
      and (r.created_by = auth.uid() or is_admin()
           or (r.crew_id is not null and is_crew_staff(r.crew_id)))
  );
$$;
revoke all on function public.pft_race_can_manage(uuid) from public;
grant execute on function public.pft_race_can_manage(uuid) to authenticated;

-- ---------- 생성 (관리자 / 크루 운영진) ---------------------------------------
create or replace function public.pft_race_create(p_title text, p_crew_slug text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_crew uuid; v_code text; v_id uuid; v_title text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  v_title := left(trim(coalesce(p_title, '')), 80);
  if v_title = '' then return jsonb_build_object('error', 'invalid_title'); end if;
  if p_crew_slug is not null then
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
  insert into pft_races (code, title, crew_id, created_by)
  values (v_code, v_title, v_crew, v_uid) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end; $$;
revoke all on function public.pft_race_create(text, text) from public;
grant execute on function public.pft_race_create(text, text) to authenticated;

create or replace function public.pft_race_set_status(p_race uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if p_status not in ('open', 'closed') then return jsonb_build_object('error', 'invalid_status'); end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  update pft_races set status = p_status,
         closed_at = case when p_status = 'closed' then now() else null end
   where id = p_race;
  return jsonb_build_object('ok', true, 'status', p_status);
end; $$;
revoke all on function public.pft_race_set_status(uuid, text) from public;
grant execute on function public.pft_race_set_status(uuid, text) to authenticated;

-- ---------- 참가·진행 (본인 엔트리) -------------------------------------------
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
  insert into pft_race_entries (race_id, user_id) values (r.id, v_uid)
  on conflict (race_id, user_id) do update set updated_at = now()
  returning id into v_entry;
  return jsonb_build_object('ok', true, 'race_id', r.id, 'code', r.code, 'entry_id', v_entry);
end; $$;
revoke all on function public.pft_race_join(text) from public;
grant execute on function public.pft_race_join(text) to authenticated;

/** 내 엔트리 상태를 jsonb 로 — 클라이언트가 그대로 화면에 반영한다 */
create or replace function public._pft_entry_json(p_entry uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'entry_id', e.id, 'race_id', e.race_id, 'started_at', e.started_at,
    'splits', to_jsonb(e.splits), 'finished_at', e.finished_at, 'total_ms', e.total_ms,
    'scaled', e.scaled, 'result_id', e.result_id, 'status', r.status)
  from pft_race_entries e join pft_races r on r.id = e.race_id where e.id = p_entry;
$$;
revoke all on function public._pft_entry_json(uuid) from public, anon, authenticated;

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
  -- 스플릿이 없을 때만 (재)시작 허용 — 찍은 게 있으면 reset 을 거쳐야 한다
  if cardinality(rec.splits) > 0 then return jsonb_build_object('error', 'already_started'); end if;
  update pft_race_entries set started_at = now(), scaled = coalesce(p_scaled, false), updated_at = now()
   where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public.pft_race_start(uuid, boolean) from public;
grant execute on function public.pft_race_start(uuid, boolean) to authenticated;

create or replace function public.pft_race_split(p_race uuid, p_elapsed_ms integer)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); rec record; v_n int; v_prev int;
  v_age int; v_gender text; v_res uuid; v_title text; v_cols int[];
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select en.*, r.status as race_status, r.title as race_title
    into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.race_id = p_race and en.user_id = v_uid for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.started_at is null then return jsonb_build_object('error', 'not_started'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished'); end if;
  v_n := cardinality(rec.splits);
  v_prev := case when v_n = 0 then 0 else rec.splits[v_n] end;
  if p_elapsed_ms is null or p_elapsed_ms <= v_prev or p_elapsed_ms > 10800000 then
    return jsonb_build_object('error', 'invalid_elapsed', 'last', v_prev);
  end if;
  update pft_race_entries set splits = splits || p_elapsed_ms, updated_at = now() where id = rec.id;
  v_n := v_n + 1;
  if v_n = 6 then
    -- 완주: 회원 기록으로 저장(배지·리더보드). 5분 미만은 pft_results 의 check 에 걸리므로 기록 없이 완주만.
    select case when birth_year is null then null
                else extract(year from app_today())::int - birth_year end,
           case when gender in ('male','female','other') then gender end
      into v_age, v_gender from profiles where id = v_uid;
    v_cols := rec.splits || p_elapsed_ms;
    if p_elapsed_ms >= 300000 then
      insert into pft_results
        (user_id, tested_on, total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms,
         age, gender, scaled, location, shared)
      values (v_uid, app_today(), p_elapsed_ms,
              v_cols[1], v_cols[2]-v_cols[1], v_cols[3]-v_cols[2], v_cols[4]-v_cols[3],
              v_cols[5]-v_cols[4], v_cols[6]-v_cols[5],
              v_age, v_gender, rec.scaled, left(rec.race_title, 80), true)
      returning id into v_res;
    end if;
    update pft_race_entries set finished_at = now(), total_ms = p_elapsed_ms, result_id = v_res,
           updated_at = now() where id = rec.id;
  end if;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public.pft_race_split(uuid, integer) from public;
grant execute on function public.pft_race_split(uuid, integer) to authenticated;

create or replace function public.pft_race_undo(p_race uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); rec record; v_n int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select en.*, r.status as race_status into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.race_id = p_race and en.user_id = v_uid for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  v_n := cardinality(rec.splits);
  if v_n = 0 then return jsonb_build_object('error', 'nothing_to_undo'); end if;
  if rec.finished_at is not null then
    -- 완주 취소: 자동 저장한 기록은 soft delete (리더보드에서 빠진다)
    if rec.result_id is not null then
      update pft_results set deleted_at = now() where id = rec.result_id and deleted_at is null;
    end if;
    update pft_race_entries set finished_at = null, total_ms = null, result_id = null where id = rec.id;
  end if;
  update pft_race_entries set splits = splits[1:v_n-1], updated_at = now() where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public.pft_race_undo(uuid) from public;
grant execute on function public.pft_race_undo(uuid) to authenticated;

create or replace function public.pft_race_reset(p_race uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); rec record;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  select en.*, r.status as race_status into rec from pft_race_entries en join pft_races r on r.id = en.race_id
   where en.race_id = p_race and en.user_id = v_uid for update;
  if rec.id is null then return jsonb_build_object('error', 'not_joined'); end if;
  if rec.race_status = 'closed' then return jsonb_build_object('error', 'race_closed'); end if;
  if rec.finished_at is not null then return jsonb_build_object('error', 'already_finished',
      'hint', '완주 기록은 undo 로 먼저 취소하세요.'); end if;
  update pft_race_entries set started_at = null, splits = '{}', updated_at = now() where id = rec.id;
  return _pft_entry_json(rec.id);
end; $$;
revoke all on function public.pft_race_reset(uuid) from public;
grant execute on function public.pft_race_reset(uuid) to authenticated;

create or replace function public.pft_race_my_entry(p_race uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select _pft_entry_json(e.id) from pft_race_entries e
  where e.race_id = p_race and e.user_id = auth.uid();
$$;
revoke all on function public.pft_race_my_entry(uuid) from public;
grant execute on function public.pft_race_my_entry(uuid) to authenticated;

-- ---------- 공개 보드 (로그인 없이) ----------------------------------------
-- 이름은 profiles 가 본인만 읽히므로 여기서 함께 돌려준다. 정렬은 클라이언트가 한다
-- (진행 중인 참가자의 경과 시간은 보드 시계로 흐르기 때문).
create or replace function public.pft_race_board(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'code', r.code, 'title', r.title, 'status', r.status,
                               'crew', c.name, 'crew_slug', c.slug, 'created_at', r.created_at),
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
  v_admin uuid; v_user uuid; j jsonb; v_race uuid; v_code text; i int; v_res uuid;
begin
  select id into v_admin from public.profiles where is_admin and not disabled limit 1;
  select id into v_user from public.profiles where not is_admin and not disabled limit 1;
  if v_admin is null then raise notice '가드 건너뜀: 관리자 없음'; return; end if;
  v_user := coalesce(v_user, v_admin);

  -- 비관리자는 생성 불가
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  if v_user <> v_admin and (public.pft_race_create('가드'))->>'error' is distinct from 'not_allowed' then
    raise exception '가드: 비관리자가 레이스를 만들었다'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_create('가드 레이스');
  if j->>'ok' is distinct from 'true' then raise exception '가드: 생성 실패 %', j; end if;
  v_race := (j->>'id')::uuid; v_code := j->>'code';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_join(lower(v_code));
  if j->>'ok' is distinct from 'true' then raise exception '가드: 참가 실패 %', j; end if;
  if (public.pft_race_split(v_race, 1000))->>'error' is distinct from 'not_started' then
    raise exception '가드: 시작 전에 스플릿이 찍혔다'; end if;
  j := public.pft_race_start(v_race);
  if j->'started_at' is null then raise exception '가드: 시작 실패 %', j; end if;
  if (public.pft_race_split(v_race, 0))->>'error' is distinct from 'invalid_elapsed' then
    raise exception '가드: 0ms 스플릿이 통과했다'; end if;
  for i in 1..6 loop
    j := public.pft_race_split(v_race, i * 240000);   -- 4분 간격, 총 24분
    if j ? 'error' then raise exception '가드: 스플릿 % 실패 %', i, j; end if;
  end loop;
  if j->>'total_ms' is distinct from '1440000' or j->'result_id' is null then
    raise exception '가드: 완주 처리 이상 %', j; end if;
  v_res := (j->>'result_id')::uuid;
  perform 1 from public.pft_results where id = v_res and total_ms = 1440000 and run_ms = 240000
     and wallball_ms = 240000 and location = '가드 레이스' and user_id = v_user;
  if not found then raise exception '가드: pft_results 자동 저장이 기대와 다르다'; end if;
  if (public.pft_race_split(v_race, 1500000))->>'error' is distinct from 'already_finished' then
    raise exception '가드: 완주 뒤 스플릿이 찍혔다'; end if;

  -- 보드(익명)
  perform set_config('request.jwt.claims', '', true);
  j := public.pft_race_board(v_code);
  if jsonb_array_length(j->'entries') <> 1 or j->'entries'->0->>'total_ms' <> '1440000'
     or j->'entries'->0->>'badge' is null then
    raise exception '가드: 보드 응답 이상 %', j; end if;

  -- 완주 취소 → 기록 soft delete, 스플릿 5개
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_undo(v_race);
  if jsonb_array_length(j->'splits') <> 5 or j->>'finished_at' is not null then
    raise exception '가드: 완주 취소 이상 %', j; end if;
  perform 1 from public.pft_results where id = v_res and deleted_at is not null;
  if not found then raise exception '가드: 취소된 기록이 soft delete 되지 않았다'; end if;

  -- 종료되면 참가·스플릿 불가
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_set_status(v_race, 'closed');
  if j->>'ok' is distinct from 'true' then raise exception '가드: 종료 실패 %', j; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  if (public.pft_race_split(v_race, 1500000))->>'error' is distinct from 'race_closed' then
    raise exception '가드: 종료된 레이스에 스플릿이 찍혔다'; end if;
  if (public.pft_race_join(v_code))->>'error' is distinct from 'race_closed' then
    raise exception '가드: 종료된 레이스에 참가됐다'; end if;
  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
