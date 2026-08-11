-- 크루 운영 — 이름 불변, 리더(owner) 1명·부리더(coach) 다수, 소유자 삭제, 운영 RPC.

-- 1) 크루명 변경 불가 (관리자 예외) — status 가드에 name 가드 추가
create or replace function public.crews_guard_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from old.status and not is_admin() then
    raise exception 'only admin can change crew status';
  end if;
  if new.name is distinct from old.name and not is_admin() then
    raise exception '크루명은 변경할 수 없습니다';
  end if;
  return new;
end;
$$;

-- 2) 크루 삭제 — 리더(owner) 또는 관리자
drop policy if exists crews_delete_admin on public.crews;
drop policy if exists crews_delete_owner on public.crews;
create policy crews_delete_owner on public.crews
  for delete using (
    is_admin() or exists (
      select 1 from crew_members m
      where m.crew_id = id and m.user_id = auth.uid() and m.role = 'owner'
    )
  );

-- 3) 멤버 role 가드 — role 변경은 리더만, owner 승격/강등은 위임 RPC 로만
create or replace function public.crew_members_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare bypass boolean := coalesce(current_setting('rox.crew_role_bypass', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    -- 첫 멤버(크루 생성자 owner 등록)만 role 지정 허용, 이후엔 member 로만 가입
    if new.role <> 'member' and not (bypass or is_admin())
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
drop trigger if exists crew_members_role_guard on public.crew_members;
create trigger crew_members_role_guard before insert or update on public.crew_members
  for each row execute function public.crew_members_guard();

-- 4) 리더 위임 — 리더 1명 불변 (기존 리더는 부리더로)
create or replace function public.transfer_crew_leader(p_slug text, p_user uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select id into v_crew from crews where slug = p_slug;
  if v_crew is null then raise exception '크루를 찾을 수 없습니다'; end if;
  if not (is_admin() or exists (
    select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = auth.uid() and m.role = 'owner'
  )) then raise exception '리더만 위임할 수 있습니다'; end if;
  if not exists (
    select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = p_user and m.status = 'active'
  ) then raise exception '활성 크루원에게만 위임할 수 있습니다'; end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set role = 'coach' where crew_id = v_crew and role = 'owner';
  update crew_members set role = 'owner' where crew_id = v_crew and user_id = p_user;
end;
$$;
grant execute on function public.transfer_crew_leader(text, uuid) to authenticated;

-- 5) 부리더 지정/해제 — 리더만, coach|member 만 허용
create or replace function public.set_crew_role(p_slug text, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  if p_role not in ('coach', 'member') then raise exception '허용되지 않는 역할입니다'; end if;
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
grant execute on function public.set_crew_role(text, uuid, text) to authenticated;

-- 6) 운영용 명단 — 스태프 전용, 가입 신청(pending) 포함 + 표시 이름
create or replace function public.crew_manage_roster(p_slug text)
returns table(user_id uuid, display_name text, role text, status text, joined_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), m.role, m.status, m.joined_at
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  where c.slug = p_slug and (is_crew_staff(c.id) or is_admin())
  order by case m.status when 'pending' then 0 else 1 end,
           case m.role when 'owner' then 0 when 'coach' then 1 else 2 end,
           m.joined_at;
$$;
grant execute on function public.crew_manage_roster(text) to authenticated;
