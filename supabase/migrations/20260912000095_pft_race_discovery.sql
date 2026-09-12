-- ============================================================
-- Roxlogy — PFT 레이스 찾기: 참가 가능한 레이스 목록 + 관리자 전체 목록
--
-- 지금까지 참가는 "6자리 코드를 받아 입력"뿐이었다. 현장에서는 코드를 못 받은 사람이
-- 많아서, 참가 화면이 먼저 "지금 참가할 수 있는 레이스"를 보여 주고 고르게 한다.
--   · pft_race_joinable()   — 진행 중 + 코드 참가 허용 레이스 중, 내 크루 것이거나 크루 없는 것.
--                             남의 크루 레이스는 목록에 넣지 않는다(코드를 받았으면 코드로 참가).
--   · pft_race_admin_list() — 전체 관리자만. 누가 만들었든 모든 레이스를 한 화면에서 본다.
--
-- 레이스 행 자체는 보드 때문에 RLS 가 전체 공개이므로 이 두 함수는 "노출"을 늘리지 않는다.
-- 다만 목록을 아무에게나 뿌리면 남의 크루 행사가 보이므로 위처럼 좁힌다.
-- ============================================================

create or replace function public.pft_race_joinable()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'code', s.code, 'title', s.title, 'created_at', s.created_at,
             'crew', s.crew, 'crew_slug', s.crew_slug,
             'entries', s.entries, 'joined', s.joined)
           order by s.joined, s.created_at desc)
    from (
      select r.id, r.code, r.title, r.created_at, c.name as crew, c.slug as crew_slug,
             (select count(*) from pft_race_entries e where e.race_id = r.id) as entries,
             exists (select 1 from pft_race_entries e where e.race_id = r.id and e.user_id = v_uid) as joined
      from pft_races r left join crews c on c.id = r.crew_id
      where r.status = 'open' and r.join_open
        and (r.crew_id is null
             or exists (select 1 from crew_members m
                         where m.crew_id = r.crew_id and m.user_id = v_uid and m.status = 'active'))
      order by r.created_at desc
      limit 50) s), '[]'::jsonb);
end; $$;
revoke all on function public.pft_race_joinable() from public;
grant execute on function public.pft_race_joinable() to authenticated;

-- 관리자 전체 목록 — 누가 만들었든 모든 레이스
create or replace function public.pft_race_admin_list()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not is_admin() then return jsonb_build_object('error', 'not_allowed'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'code', s.code, 'title', s.title, 'status', s.status,
             'join_open', s.join_open, 'created_at', s.created_at, 'closed_at', s.closed_at,
             'crew', s.crew, 'created_by', s.created_by,
             'entries', s.entries, 'finished', s.finished)
           order by s.created_at desc)
    from (
      select r.id, r.code, r.title, r.status, r.join_open, r.created_at, r.closed_at,
             c.name as crew,
             coalesce(nullif(p.display_name, ''), 'Athlete') as created_by,
             (select count(*) from pft_race_entries e where e.race_id = r.id) as entries,
             (select count(*) from pft_race_entries e
               where e.race_id = r.id and e.finished_at is not null) as finished
      from pft_races r
      left join crews c on c.id = r.crew_id
      left join profiles p on p.id = r.created_by
      order by r.created_at desc
      limit 300) s), '[]'::jsonb);
end; $$;
revoke all on function public.pft_race_admin_list() from public;
grant execute on function public.pft_race_admin_list() to authenticated;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_user uuid; j jsonb; v_open uuid; v_closed uuid; v_nocode uuid;
  v_codes text[];
begin
  select id into v_admin from public.profiles where is_admin and not disabled limit 1;
  select id into v_user from public.profiles where not is_admin and not disabled limit 1;
  if v_admin is null or v_user is null then raise notice '가드 건너뜀: 계정 부족'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_create('가드 진행중');            v_open := (j->>'id')::uuid;
  j := public.pft_race_create('가드 종료됨');            v_closed := (j->>'id')::uuid;
  perform public.pft_race_set_status(v_closed, 'closed');
  j := public.pft_race_create('가드 코드없음', null, false); v_nocode := (j->>'id')::uuid;

  -- 일반 사용자: 진행 중 + 코드 참가 레이스만 보인다
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_joinable();
  if jsonb_typeof(j) <> 'array' then raise exception '가드: joinable 응답 이상 %', j; end if;
  select array_agg(x->>'id') into v_codes from jsonb_array_elements(j) x;
  if not (v_open::text = any(v_codes)) then raise exception '가드: 진행 중 레이스가 목록에 없다'; end if;
  if v_closed::text = any(v_codes) then raise exception '가드: 종료된 레이스가 목록에 있다'; end if;
  if v_nocode::text = any(v_codes) then raise exception '가드: 코드 없는 레이스가 목록에 있다'; end if;

  -- 관리자 전용 목록
  if (public.pft_race_admin_list())->>'error' is distinct from 'not_allowed' then
    raise exception '가드: 비관리자가 전체 목록을 봤다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.pft_race_admin_list();
  if jsonb_typeof(j) <> 'array' then raise exception '가드: 관리자 목록 응답 이상 %', j; end if;
  select array_agg(x->>'id') into v_codes from jsonb_array_elements(j) x;
  if not (v_closed::text = any(v_codes) and v_nocode::text = any(v_codes)) then
    raise exception '가드: 관리자 목록에 종료·코드없음 레이스가 빠졌다'; end if;

  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
