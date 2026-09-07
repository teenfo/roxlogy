-- ============================================================
-- Roxlogy — 관리자 사용자 상세 + 프로필 수정, 그리고 권한 상승 구멍 차단
--
-- (1) 발견한 문제
--   profiles_update 정책이 `auth.uid() = id or is_admin()` 하나뿐이라
--   일반 사용자가 **자기 행의 is_admin 을 true 로** 올릴 수 있었다.
--   같은 경로로 disabled 를 되돌리거나 mcp_token(자격증명)을 자기가 고른
--   값으로 심는 것도 가능했다. anon 키만 있으면 되는 실제 권한 상승이다.
--   → 정책만으로는 컬럼 단위를 못 막으므로 BEFORE UPDATE 가드를 둔다.
--
-- (2) 관리자 화면
--   admin_user_detail  : 사용자 1명의 계정·프로필·활동·크루를 한 번에
--   admin_update_profile: 화이트리스트된 컬럼만 수정. mcp_token 은 절대 불가.
--     본인 계정의 관리자 권한 회수·비활성은 막는다(스스로 잠기는 사고 방지).
-- ============================================================

-- 1) 특권 컬럼 가드 -----------------------------------------------------------
create or replace function public.profiles_privileged_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_admin boolean;
begin
  -- JWT 없는 호출(마이그레이션·service_role·Edge)은 이미 신뢰 경계 안이다
  if v_actor is null
     or coalesce(current_setting('rox.profile_bypass', true), '') = '1' then
    return new;
  end if;

  select coalesce(p.is_admin, false) into v_admin from profiles p where p.id = v_actor;
  v_admin := coalesce(v_admin, false);

  if not v_admin and (new.is_admin is distinct from old.is_admin
                      or new.disabled is distinct from old.disabled) then
    raise exception 'profile_admin_only';
  end if;

  -- MCP 토큰은 자격증명이다. 클라이언트가 값을 고를 수 있으면 예측 가능한
  -- 토큰을 심을 수 있으므로 관리자에게도 열지 않는다(재발급 전용 경로만).
  if new.mcp_token is distinct from old.mcp_token then
    raise exception 'profile_token_locked';
  end if;

  return new;
end;
$$;
revoke all on function public.profiles_privileged_guard() from public;

drop trigger if exists profiles_privileged_guard on public.profiles;
create trigger profiles_privileged_guard
  before update on public.profiles
  for each row execute function public.profiles_privileged_guard();

-- 2) 사용자 상세 --------------------------------------------------------------
create or replace function public.admin_user_detail(p_user uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', p.id,
    'email', u.email::text,
    'email_confirmed_at', u.email_confirmed_at,
    'last_sign_in_at', u.last_sign_in_at,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'display_name', p.display_name,
    'division', p.division,
    'gender', p.gender,
    'birth_year', p.birth_year,
    'height_cm', p.height_cm,
    'weight_kg', p.weight_kg,
    'timezone', p.timezone,
    'locale', p.locale,
    'wod_reminder_time', p.wod_reminder_time,
    'hyrox_athlete_name', p.hyrox_athlete_name,
    'leaderboard_opt_in', p.leaderboard_opt_in,
    'is_admin', p.is_admin,
    'disabled', p.disabled,
    -- 토큰 값은 절대 내보내지 않는다. 발급 여부만.
    'has_mcp_token', (p.mcp_token is not null and length(p.mcp_token) > 0),
    'session_count', (select count(*) from sessions s
                       where s.user_id = p.id and s.deleted_at is null),
    'last_session_at', (select max(s.started_at) from sessions s
                         where s.user_id = p.id and s.deleted_at is null),
    'race_count', (select count(*) from race_results r where r.user_id = p.id),
    'pft_count', (select count(*) from pft_results f
                   where f.user_id = p.id and f.deleted_at is null),
    'program_count', (select count(*) from programs pr where pr.owner_id = p.id),
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'role', m.role,
        'status', m.status, 'tier', t.name)
        order by c.name)
      from crew_members m
      join crews c on c.id = m.crew_id
      left join crew_member_tiers t on t.id = m.tier_id
      where m.user_id = p.id), '[]'::jsonb)
  )
  from profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user and (select is_admin());
$$;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- 3) 프로필 수정 (화이트리스트) -----------------------------------------------
create or replace function public.admin_update_profile(p_user uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  k text;
  allowed constant text[] := array[
    'display_name', 'division', 'gender', 'birth_year', 'height_cm', 'weight_kg',
    'timezone', 'locale', 'wod_reminder_time', 'hyrox_athlete_name',
    'leaderboard_opt_in', 'is_admin', 'disabled'
  ];
  v_div text;
  v_gender text;
  v_locale text;
  v_tz text;
begin
  if not (select is_admin()) then raise exception 'admin_only'; end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'user_not_found';
  end if;

  -- 알 수 없는 키는 조용히 무시하지 않고 시끄럽게 실패시킨다 (오타 방지)
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(allowed)) then
      raise exception 'field_not_editable:%', k;
    end if;
  end loop;

  -- 스스로 잠기는 사고 방지
  if p_user = auth.uid() then
    if (p_patch ? 'is_admin') and (p_patch->>'is_admin')::boolean is not true then
      raise exception 'admin_self_demote';
    end if;
    if (p_patch ? 'disabled') and (p_patch->>'disabled')::boolean is true then
      raise exception 'admin_self_disable';
    end if;
  end if;

  v_div := nullif(p_patch->>'division', '');
  if (p_patch ? 'division') and v_div is not null
     and v_div not in ('open','pro','doubles','pro_doubles','relay','mixed_doubles','mixed_relay') then
    raise exception 'bad_division';
  end if;

  v_gender := nullif(p_patch->>'gender', '');
  if (p_patch ? 'gender') and v_gender is not null
     and v_gender not in ('male','female','other') then
    raise exception 'bad_gender';
  end if;

  v_locale := nullif(p_patch->>'locale', '');
  if (p_patch ? 'locale') and v_locale is not null and v_locale not in ('ko','en','es') then
    raise exception 'bad_locale';
  end if;

  -- 잘못된 시간대를 넣으면 "오늘" 판정이 통째로 깨진다 — 저장 전에 검증한다
  v_tz := nullif(p_patch->>'timezone', '');
  if (p_patch ? 'timezone') and v_tz is not null then
    begin
      perform now() at time zone v_tz;
    exception when others then
      raise exception 'bad_timezone';
    end;
  end if;

  update profiles p set
    display_name = case when p_patch ? 'display_name'
                        then nullif(p_patch->>'display_name', '') else p.display_name end,
    division = case when p_patch ? 'division' then v_div else p.division end,
    gender = case when p_patch ? 'gender' then v_gender else p.gender end,
    birth_year = case when p_patch ? 'birth_year'
                      then nullif(p_patch->>'birth_year', '')::int else p.birth_year end,
    height_cm = case when p_patch ? 'height_cm'
                     then nullif(p_patch->>'height_cm', '')::numeric else p.height_cm end,
    weight_kg = case when p_patch ? 'weight_kg'
                     then nullif(p_patch->>'weight_kg', '')::numeric else p.weight_kg end,
    timezone = case when p_patch ? 'timezone' then v_tz else p.timezone end,
    locale = case when p_patch ? 'locale' then v_locale else p.locale end,
    wod_reminder_time = case when p_patch ? 'wod_reminder_time'
                             then nullif(p_patch->>'wod_reminder_time', '')::time
                             else p.wod_reminder_time end,
    hyrox_athlete_name = case when p_patch ? 'hyrox_athlete_name'
                              then nullif(p_patch->>'hyrox_athlete_name', '')
                              else p.hyrox_athlete_name end,
    leaderboard_opt_in = case when p_patch ? 'leaderboard_opt_in'
                              then (p_patch->>'leaderboard_opt_in')::boolean
                              else p.leaderboard_opt_in end,
    is_admin = case when p_patch ? 'is_admin'
                    then (p_patch->>'is_admin')::boolean else p.is_admin end,
    disabled = case when p_patch ? 'disabled'
                    then (p_patch->>'disabled')::boolean else p.disabled end
  where p.id = p_user;

  return public.admin_user_detail(p_user);
end;
$$;
grant execute on function public.admin_update_profile(uuid, jsonb) to authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare
  v_plain uuid; v_admin uuid; v_msg text; v_now boolean;
begin
  select id into v_admin from public.profiles where is_admin limit 1;
  select id into v_plain from public.profiles where not is_admin limit 1;
  if v_plain is null or v_admin is null then return; end if;

  -- (a) 일반 사용자의 자가 승격이 막혀야 한다
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_plain::text, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set is_admin = true where id = v_plain;
    v_msg := 'FAIL';
  exception when others then v_msg := sqlerrm;
  end;
  select is_admin into v_now from public.profiles where id = v_plain;
  if v_msg = 'FAIL' or v_now then
    raise exception '가드: 일반 사용자가 아직 스스로 관리자가 될 수 있습니다 (%)', v_msg;
  end if;

  -- (b) mcp_token 은 관리자도 못 바꾼다
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set mcp_token = 'x' || gen_random_uuid()::text where id = v_plain;
    raise exception '가드: mcp_token 이 클라이언트에서 변경 가능합니다';
  exception
    when others then
      if sqlerrm not like '%profile_token_locked%' then raise; end if;
  end;

  -- (c) 관리자 RPC 가 허용되지 않은 컬럼을 거부해야 한다
  begin
    perform public.admin_update_profile(v_plain, '{"mcp_token":"nope"}'::jsonb);
    raise exception '가드: admin_update_profile 이 mcp_token 을 받았습니다';
  exception
    when others then
      if sqlerrm not like '%field_not_editable%' then raise; end if;
  end;

  perform set_config('request.jwt.claims', '', true);
end $$;
