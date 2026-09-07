-- ============================================================
-- Roxlogy — 프로필 인스타그램 아이디
--
-- 크루원끼리 서로 찾을 수 있게 프로필에 인스타 핸들을 둔다.
-- 저장은 '@' 없는 핸들만. 인스타 규칙(영문·숫자·마침표·밑줄, 30자)을
-- 체크 제약으로 강제해, URL 을 통째로 붙여넣거나 '@' 가 섞여 들어오는 것을
-- DB 에서 막는다(화면에서도 정규화하지만 최종 방어는 여기).
-- 공개 프로필에 노출되므로 본인이 넣은 값만 저장한다.
-- ============================================================

alter table public.profiles
  add column if not exists instagram text
    check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');

-- 공개 프로필 RPC 에 노출 (반환형 변경 → 재생성)
-- 주의: 이 함수에는 공개 범위 게이트가 있다 — 본인 / 공개 세션이 있는 사람 /
-- 리더보드 참여자 / 같은 크루원 에게만 프로필을 보여준다. 컬럼만 추가하고
-- 그 조건은 그대로 둔다.
drop function if exists public.public_profile(uuid);
create function public.public_profile(p_user uuid)
returns table(
  display_name text, division text, shared_count bigint,
  leaderboard_opt_in boolean, instagram text
)
language sql stable security definer set search_path to 'public' as $$
  select
    pr.display_name,
    pr.division,
    (select count(*) from sessions s
       where s.user_id = p_user and s.shared and s.deleted_at is null),
    coalesce(pr.leaderboard_opt_in, false),
    pr.instagram
  from profiles pr
  where pr.id = p_user
    and (
      p_user = auth.uid()
      or exists (select 1 from sessions s
        where s.user_id = p_user and s.shared and s.deleted_at is null)
      or coalesce(pr.leaderboard_opt_in, false)
      or exists (
        select 1
        from crew_members me
        join crew_members them on them.crew_id = me.crew_id
        where me.user_id = auth.uid() and me.status = 'active'
          and them.user_id = p_user and them.status = 'active'
      )
    );
$$;
grant execute on function public.public_profile(uuid) to anon, authenticated;

-- 관리자 수정 화이트리스트에 추가
create or replace function public.admin_update_profile(p_user uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  k text;
  allowed constant text[] := array[
    'display_name', 'division', 'gender', 'birth_year', 'height_cm', 'weight_kg',
    'timezone', 'locale', 'wod_reminder_time', 'hyrox_athlete_name',
    'leaderboard_opt_in', 'is_admin', 'disabled', 'instagram'
  ];
  v_div text; v_gender text; v_locale text; v_tz text; v_ig text;
begin
  if not (select is_admin()) then raise exception 'admin_only'; end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'user_not_found';
  end if;

  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(allowed)) then
      raise exception 'field_not_editable:%', k;
    end if;
  end loop;

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

  v_tz := nullif(p_patch->>'timezone', '');
  if (p_patch ? 'timezone') and v_tz is not null then
    begin
      perform now() at time zone v_tz;
    exception when others then
      raise exception 'bad_timezone';
    end;
  end if;

  -- '@' 나 URL 이 섞여 들어와도 핸들만 남긴다
  v_ig := nullif(btrim(regexp_replace(coalesce(p_patch->>'instagram', ''),
                                      '^.*instagram\.com/|^@|/.*$', '', 'g')), '');
  if (p_patch ? 'instagram') and v_ig is not null and v_ig !~ '^[A-Za-z0-9._]{1,30}$' then
    raise exception 'bad_instagram';
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
    instagram = case when p_patch ? 'instagram' then v_ig else p.instagram end,
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

-- 관리자 상세에도 노출
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
    'instagram', p.instagram,
    'leaderboard_opt_in', p.leaderboard_opt_in,
    'is_admin', p.is_admin,
    'disabled', p.disabled,
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

do $$
declare v_uid uuid; v_msg text;
begin
  -- 잘못된 핸들은 DB 에서 막혀야 한다
  select id into v_uid from public.profiles limit 1;
  if v_uid is null then return; end if;
  begin
    update public.profiles set instagram = 'not a handle!' where id = v_uid;
    raise exception '가드: 잘못된 인스타 아이디가 저장됩니다';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set instagram = '@leading_at' where id = v_uid;
    raise exception '가드: @ 가 붙은 채로 저장됩니다';
  exception when check_violation then null;
  end;

  if not exists (
    select 1 from pg_proc p, unnest(p.proargnames) as a(nm)
    where p.pronamespace = 'public'::regnamespace and p.proname = 'public_profile'
      and a.nm = 'instagram'
  ) then raise exception '가드: 공개 프로필에 instagram 이 없습니다'; end if;
end $$;
