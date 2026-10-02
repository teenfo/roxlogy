-- ============================================================
-- Roxlogy — 크루장 등급은 정회원 등급 안에서만 (2026-10-02)
--
-- 그동안 화면이 크루장 행의 등급 선택을 꺼 두어 크루장 등급을 바꿀 수 없었다.
-- 이제 크루장도 등급을 바꿀 수 있되 is_full_member 등급으로만 — 크루장이 일반회원
-- 요금·권한 등급에 들어가는 일은 없게 한다. 웹(set_crew_tier)과 MCP(mcp_set_member_tier)
-- 두 경로 모두 여기서 막는다. 역할(owner)은 등급 동기화 트리거가 건드리지 않는다.
--
-- 이름·인자·반환 모양은 그대로(검사만 추가) — 배포 순서 무관.
-- 되돌리기: 두 함수에서 tier_owner_full_only 분기를 지운 정의를 다시 적용.
-- ============================================================

create or replace function public.set_crew_tier(p_slug text, p_user uuid, p_tier uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select id into v_crew from crews where slug = p_slug;
  if v_crew is null then raise exception 'crew_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'tier_not_staff';
  end if;
  if p_tier is not null and not exists (
    select 1 from crew_member_tiers where id = p_tier and crew_id = v_crew
  ) then raise exception 'tier_wrong_crew'; end if;
  -- 크루장은 정회원 등급으로만
  if exists (select 1 from crew_members
              where crew_id = v_crew and user_id = p_user and role = 'owner')
     and not coalesce((select is_full_member from crew_member_tiers where id = p_tier), false) then
    raise exception 'tier_owner_full_only';
  end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set tier_id = p_tier
   where crew_id = v_crew and user_id = p_user;
end; $$;
grant execute on function public.set_crew_tier(text, uuid, uuid) to authenticated;

create or replace function public.mcp_set_member_tier(p_token text, p_slug text, p_user_id uuid, p_tier text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_tier uuid; v_full boolean; v_name text;
begin
  if v_crew is null then return null; end if;
  select id, is_full_member into v_tier, v_full from crew_member_tiers
   where crew_id = v_crew and name = btrim(p_tier) and archived_at is null;
  if v_tier is null then
    return jsonb_build_object('error', 'tier_not_found',
      'available', (select jsonb_agg(name order by sort_order)
                      from crew_member_tiers
                     where crew_id = v_crew and archived_at is null));
  end if;
  if not exists (select 1 from crew_members
                  where crew_id = v_crew and user_id = p_user_id and status = 'active') then
    return jsonb_build_object('error', 'not_a_member');
  end if;
  -- 크루장은 정회원 등급으로만
  if not coalesce(v_full, false) and exists (
       select 1 from crew_members where crew_id = v_crew and user_id = p_user_id and role = 'owner') then
    return jsonb_build_object('error', 'tier_owner_full_only',
      'available', (select jsonb_agg(name order by sort_order)
                      from crew_member_tiers
                     where crew_id = v_crew and archived_at is null and is_full_member));
  end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set tier_id = v_tier where crew_id = v_crew and user_id = p_user_id;
  select display_name into v_name from profiles where id = p_user_id;
  return jsonb_build_object('ok', true, 'user', coalesce(v_name, 'Athlete'),
                            'tier', btrim(p_tier));
end; $$;
grant execute on function public.mcp_set_member_tier(text, text, uuid, text) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 정회원·비정회원 등급이 둘 다 있는 크루의 크루장으로 확인한 뒤 되감는다(운영 데이터 무변경).
do $$
declare
  v_crew uuid; v_slug text; v_owner uuid; v_full uuid; v_part uuid; v_role text; v_tier uuid;
begin
  select c.id, c.slug, m.user_id into v_crew, v_slug, v_owner
    from crews c join crew_members m on m.crew_id = c.id and m.role = 'owner' and m.status = 'active'
   where exists (select 1 from crew_member_tiers t where t.crew_id = c.id and t.is_full_member and t.archived_at is null)
     and exists (select 1 from crew_member_tiers t where t.crew_id = c.id and not t.is_full_member and t.archived_at is null)
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 정회원·비정회원 등급이 함께 있는 크루 없음'; return; end if;
  select id into v_full from crew_member_tiers where crew_id = v_crew and is_full_member and archived_at is null limit 1;
  select id into v_part from crew_member_tiers where crew_id = v_crew and not is_full_member and archived_at is null limit 1;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    -- 정회원 등급으로는 바뀌고, 역할은 owner 그대로
    perform set_crew_tier(v_slug, v_owner, v_full);
    select role, tier_id into v_role, v_tier from crew_members where crew_id = v_crew and user_id = v_owner;
    if v_role <> 'owner' or v_tier <> v_full then raise exception '가드: 크루장 정회원 등급 변경 % %', v_role, v_tier; end if;
    -- 비정회원 등급은 거부
    begin
      perform set_crew_tier(v_slug, v_owner, v_part);
      raise exception '가드: 크루장이 비정회원 등급으로 바뀜';
    exception when raise_exception then
      if sqlerrm <> 'tier_owner_full_only' then raise; end if;
    end;
    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
