-- ============================================================
-- Roxlogy — 크루원 등급 분리 (정회원/일반회원)
--
-- 역할 체계: owner(리더) / coach(부리더) / member(정회원) / associate(일반회원).
-- 신규 가입 기본값은 associate — 리더가 정회원으로 승격한다.
-- 기존 member 는 정회원으로 그대로 유지 (권한 저하 없음).
-- associate 의 접근 권한은 member 와 동일(멤버십 기반) — 등급 구분·표시용.
-- ============================================================

alter table public.crew_members
  drop constraint if exists crew_members_role_check;
alter table public.crew_members
  add constraint crew_members_role_check
    check (role in ('owner', 'coach', 'member', 'associate'));
alter table public.crew_members
  alter column role set default 'associate';

-- 가드: 일반 가입은 member|associate 만 허용 (첫 멤버=owner 는 기존 예외 유지)
create or replace function public.crew_members_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare bypass boolean := coalesce(current_setting('rox.crew_role_bypass', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if new.role not in ('member', 'associate') and not (bypass or is_admin())
       and exists (select 1 from crew_members m where m.crew_id = new.crew_id) then
      raise exception '역할 지정은 리더만 할 수 있습니다';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role and not (bypass or is_admin()) then
    if not exists (
      select 1 from crew_members m
      where m.crew_id = new.crew_id and m.user_id = auth.uid() and m.role = 'owner'
    ) then
      raise exception '멤버 역할 변경은 리더만 할 수 있습니다';
    end if;
    if new.role = 'owner' or old.role = 'owner' then
      raise exception '리더는 위임 기능으로만 변경됩니다';
    end if;
  end if;
  return new;
end;
$$;

-- 역할 변경 RPC: associate 허용
create or replace function public.set_crew_role(p_slug text, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  if p_role not in ('coach', 'member', 'associate') then
    raise exception '허용되지 않는 역할입니다';
  end if;
  select id into v_crew from crews where slug = p_slug;
  if v_crew is null then raise exception '크루를 찾을 수 없습니다'; end if;
  if not (is_admin() or exists (
    select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = auth.uid() and m.role = 'owner'
  )) then raise exception '리더만 역할을 변경할 수 있습니다'; end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set role = p_role
  where crew_id = v_crew and user_id = p_user and role <> 'owner';
end;
$$;
