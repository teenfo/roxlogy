-- ============================================================
-- Roxlogy — 가입 승인은 일반회원부터, 등급 정렬 통일
--
-- 20260827000001 에서 "신규 가입 기본값 = associate" 로 정했지만
-- join_crew 가 role 을 'member' 로 명시해 넣고 있어서 컬럼 기본값이
-- 무시됐다. 승인하면 곧바로 정회원이 되던 원인.
--   1) join_crew 는 associate 로 넣는다
--   2) pending → active 로 승인되는 순간 등급을 associate 로 고정한다
--      (웹·MCP 등 모든 승인 경로가 같은 트리거를 지난다. 기존에 잘못
--       'member' 로 쌓인 대기자에게도 적용된다)
--   3) 명단 정렬을 리더 → 부리더 → 정회원 → 일반회원 으로 통일
--      (그동안 member 와 associate 가 동순위라 뒤섞였다)
-- ============================================================

-- 1) 가입 시 등급 -------------------------------------------------------------
create or replace function public.join_crew(p_slug text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_policy text; v_status text; v_cstatus text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select id, join_policy, status into v_crew, v_policy, v_cstatus from crews where slug = p_slug;
  if v_crew is null then raise exception '크루를 찾을 수 없습니다'; end if;
  if v_cstatus <> 'active' then raise exception '아직 승인되지 않은 크루입니다'; end if;
  v_status := case when v_policy = 'open' then 'active' else 'pending' end;
  -- 최초 가입은 항상 일반회원. 정회원 승격은 리더가 한다.
  insert into crew_members(crew_id, user_id, role, status)
  values (v_crew, auth.uid(), 'associate', v_status)
  on conflict (crew_id, user_id) do nothing;
  return v_status;
end;
$$;
grant execute on function public.join_crew(text) to authenticated;

-- 2) 승인 시 등급 고정 --------------------------------------------------------
-- 승인은 스태프(부리더 포함)가 하는데 등급 변경은 리더만 가능하므로,
-- 클라이언트가 role 을 같이 보내는 대신 가드 트리거가 직접 낮춰 준다.
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

  -- 가입 승인(pending → active)은 항상 일반회원으로 시작한다.
  if old.status = 'pending' and new.status = 'active'
     and new.role is not distinct from old.role
     and new.role in ('member', 'associate') then
    new.role := 'associate';
  end if;

  if new.role is distinct from old.role and not (bypass or is_admin()) then
    -- 위 승인 강등은 아래 리더 검사를 지나지 않아야 한다
    if not (old.status = 'pending' and new.status = 'active' and new.role = 'associate') then
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
  end if;
  return new;
end;
$$;

-- 3) 등급 정렬 통일 -----------------------------------------------------------
create or replace function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(
  user_id uuid, display_name text, division text, role text,
  joined_at timestamptz, session_count bigint, attend_count bigint
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), p.division, m.role, m.joined_at,
         (select count(*) from sessions s
            where s.user_id = m.user_id and s.deleted_at is null),
         case when (select is_crew_member(c.id)) or (select is_admin()) then
           (select count(*) from crew_event_rsvps r
              join crew_events e on e.id = r.event_id
             where r.user_id = m.user_id
               and e.crew_id = c.id
               and e.cancelled_at is null
               and r.checked_in_at is not null)
         else null::bigint end
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  where c.slug = p_slug and m.status = 'active'
    and (c.is_public or (select is_crew_member(c.id)))
  order by array_position(array['owner','coach','member','associate'], m.role),
           m.joined_at
  limit least(p_limit, 500);
$$;
grant execute on function public.crew_roster(text, integer) to anon, authenticated;

create or replace function public.crew_manage_roster(p_slug text)
returns table(user_id uuid, display_name text, email text, role text, status text, joined_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), u.email::text, m.role, m.status, m.joined_at
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where c.slug = p_slug and ((select is_crew_staff(c.id)) or (select is_admin()))
  order by case m.status when 'pending' then 0 else 1 end,
           array_position(array['owner','coach','member','associate'], m.role),
           m.joined_at;
$$;
grant execute on function public.crew_manage_roster(text) to authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'join_crew';
  if v_def not like '%''associate'', v_status%' then
    raise exception '가드: join_crew 가 아직 member 로 가입시킵니다';
  end if;

  -- 정렬은 네 등급 모두 구분해야 한다 (member/associate 동순위 금지)
  for v_def in
    select pg_get_functiondef(oid) from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('crew_roster', 'crew_manage_roster')
  loop
    if v_def not like '%array_position(array[''owner'',''coach'',''member'',''associate'']%' then
      raise exception '가드: 명단 정렬이 등급 4단계를 구분하지 않습니다';
    end if;
  end loop;
end $$;
