-- ============================================================
-- Roxlogy — 크루가 직접 만드는 회원 등급
--
-- 지금까지 crew_members.role 하나가 두 가지를 겸했다:
--   · 권한  : owner(리더)·coach(부리더) → is_crew_staff
--   · 등급  : associate = 일반회원, 그 외 = 정회원 → is_crew_full_member
-- 등급을 크루가 자유롭게 만들려면 두 축을 갈라야 한다.
--   role     = 권한 (고정: owner/coach/member/associate)
--   tier_id  = 등급 (크루가 추가·삭제, 이름·색·회비 지정)
-- 기존 role 기반 로직이 그대로 살아 있도록, 등급이 바뀌면 트리거가
-- role(member/associate)을 등급의 is_full_member 에 맞춰 동기화한다.
-- 등급 삭제는 쓰는 사람이 있으면 보관(archived_at) — 회비 이력이 등급을
-- 참조하기 때문에 하드 삭제는 실제로 아무도 안 쓸 때만 허용한다.
-- ============================================================

create table if not exists public.crew_member_tiers (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  sort_order int not null default 0,
  -- 뱃지 색 팔레트 키 (웹에서 클래스로 매핑). 리더·부리더 뱃지는 별개로 고정.
  color text not null default 'gray'
    check (color in ('yellow', 'blue', 'chalk', 'gray', 'green', 'red')),
  -- 정회원 전용 콘텐츠(회계·members_only 게시글/모임)를 볼 수 있는 등급인가
  is_full_member boolean not null default false,
  monthly_fee int check (monthly_fee is null or monthly_fee > 0),
  session_fee int check (session_fee is null or session_fee > 0),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (crew_id, name)
);

-- 크루당 기본 등급은 하나만
create unique index if not exists crew_member_tiers_one_default
  on public.crew_member_tiers(crew_id) where is_default and archived_at is null;
create index if not exists crew_member_tiers_crew_idx
  on public.crew_member_tiers(crew_id, sort_order);

alter table public.crew_member_tiers enable row level security;

-- 조회: 크루원(+공개 크루 방문자)은 등급 이름·색을 알아야 뱃지를 그린다
drop policy if exists crew_member_tiers_select on public.crew_member_tiers;
create policy crew_member_tiers_select on public.crew_member_tiers
  for select using (
    exists (select 1 from crews c where c.id = crew_id and c.is_public)
    or (select is_crew_member(crew_id)) or (select is_admin())
  );
drop policy if exists crew_member_tiers_insert on public.crew_member_tiers;
create policy crew_member_tiers_insert on public.crew_member_tiers
  for insert with check ((select is_crew_staff(crew_id)) or (select is_admin()));
drop policy if exists crew_member_tiers_update on public.crew_member_tiers;
create policy crew_member_tiers_update on public.crew_member_tiers
  for update using ((select is_crew_staff(crew_id)) or (select is_admin()))
  with check ((select is_crew_staff(crew_id)) or (select is_admin()));
drop policy if exists crew_member_tiers_delete on public.crew_member_tiers;
create policy crew_member_tiers_delete on public.crew_member_tiers
  for delete using ((select is_crew_staff(crew_id)) or (select is_admin()));

alter table public.crew_members
  add column if not exists tier_id uuid references public.crew_member_tiers(id) on delete set null;
create index if not exists crew_members_tier_idx on public.crew_members(tier_id);

-- 기존 크루에 기본 등급 3종 시드 + 현재 role 로 매핑 -------------------------
insert into public.crew_member_tiers
  (crew_id, name, sort_order, color, is_full_member, is_default)
select c.id, v.name, v.sort_order, v.color, v.is_full, v.is_def
from public.crews c
cross join (values
  ('정회원',   1, 'chalk', true,  false),
  ('일반회원', 2, 'gray',  false, true),
  ('게스트',   3, 'gray',  false, false)
) as v(name, sort_order, color, is_full, is_def)
on conflict (crew_id, name) do nothing;

update public.crew_members m
set tier_id = t.id
from public.crew_member_tiers t
where t.crew_id = m.crew_id
  and m.tier_id is null
  and t.name = case when m.role = 'associate' then '일반회원' else '정회원' end;

-- 등급 → role 동기화 ---------------------------------------------------------
-- 트리거 이름이 crew_members_role_guard 보다 뒤라 가드가 먼저 돈다.
-- 가드는 클라이언트가 보낸 role 만 검사하고, 그 뒤 여기서 등급에 맞춰 고친다.
create or replace function public.crew_member_tier_sync() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_full boolean; v_def uuid;
begin
  -- 등급이 비어 있으면 크루 기본 등급을 채운다 (가입·승인 경로 공통)
  if new.tier_id is null then
    select id into v_def from crew_member_tiers
     where crew_id = new.crew_id and is_default and archived_at is null limit 1;
    new.tier_id := v_def;
  end if;
  -- 리더·부리더의 role 은 권한이라 등급이 건드리지 않는다
  if new.tier_id is not null and new.role in ('member', 'associate') then
    select is_full_member into v_full from crew_member_tiers where id = new.tier_id;
    new.role := case when v_full then 'member' else 'associate' end;
  end if;
  return new;
end;
$$;

drop trigger if exists crew_members_tier_sync on public.crew_members;
create trigger crew_members_tier_sync
  before insert or update on public.crew_members
  for each row execute function public.crew_member_tier_sync();

-- 등급의 is_full_member 를 바꾸면 그 등급 멤버들의 role 도 따라간다
create or replace function public.crew_tier_resync_members() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.is_full_member is not distinct from old.is_full_member then return new; end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members
     set role = case when new.is_full_member then 'member' else 'associate' end
   where tier_id = new.id and role in ('member', 'associate');
  return new;
end;
$$;

drop trigger if exists crew_member_tiers_resync on public.crew_member_tiers;
create trigger crew_member_tiers_resync
  after update of is_full_member on public.crew_member_tiers
  for each row execute function public.crew_tier_resync_members();

-- 정회원 판정을 등급 기준으로 --------------------------------------------------
create or replace function public.is_crew_full_member(p_crew uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from crew_members m
    left join crew_member_tiers t on t.id = m.tier_id
    where m.crew_id = p_crew and m.user_id = auth.uid() and m.status = 'active'
      -- 운영진은 등급과 무관하게 정회원 취급 (기존 규칙)
      and (m.role in ('owner', 'coach')
           or coalesce(t.is_full_member, m.role <> 'associate')));
$$;

-- 등급 지정 RPC — 운영진(리더·부리더). 등급은 권한을 만들지 않으므로
-- 부리더도 지정할 수 있다(부리더 임명은 여전히 리더 전용).
create or replace function public.set_crew_tier(p_slug text, p_user uuid, p_tier uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid;
begin
  select id into v_crew from crews where slug = p_slug;
  if v_crew is null then raise exception '크루를 찾을 수 없습니다'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception '운영진만 등급을 지정할 수 있습니다';
  end if;
  if p_tier is not null and not exists (
    select 1 from crew_member_tiers where id = p_tier and crew_id = v_crew
  ) then raise exception '이 크루의 등급이 아닙니다'; end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set tier_id = p_tier
   where crew_id = v_crew and user_id = p_user;
end;
$$;
grant execute on function public.set_crew_tier(text, uuid, uuid) to authenticated;

-- 등급 삭제 RPC — 쓰는 사람이 있으면 보관, 없으면 실삭제 ----------------------
create or replace function public.delete_crew_tier(p_tier uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_used int; v_def boolean;
begin
  select crew_id, is_default into v_crew, v_def from crew_member_tiers where id = p_tier;
  if v_crew is null then raise exception '등급을 찾을 수 없습니다'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception '운영진만 등급을 삭제할 수 있습니다';
  end if;
  if v_def then raise exception '기본 등급은 삭제할 수 없습니다'; end if;
  select count(*) into v_used from crew_members where tier_id = p_tier;
  if v_used > 0 then
    update crew_member_tiers set archived_at = now(), is_default = false where id = p_tier;
    return 'archived';
  end if;
  delete from crew_member_tiers where id = p_tier;
  return 'deleted';
end;
$$;
grant execute on function public.delete_crew_tier(uuid) to authenticated;

-- 명단 RPC 에 등급 노출 + 정렬(리더 → 부리더 → 등급 순) ----------------------
drop function if exists public.crew_roster(text, integer);
create function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(
  user_id uuid, display_name text, division text, role text,
  joined_at timestamptz, session_count bigint, attend_count bigint,
  tier_id uuid, tier_name text, tier_color text
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), p.division, m.role, m.joined_at,
         (select count(*) from sessions s
            where s.user_id = m.user_id and s.deleted_at is null),
         case when (select is_crew_member(c.id)) or (select is_admin()) then
           (select count(*) from crew_event_rsvps r
              join crew_events e on e.id = r.event_id
             where r.user_id = m.user_id and e.crew_id = c.id
               and e.cancelled_at is null and r.checked_in_at is not null)
         else null::bigint end,
         t.id, t.name, t.color
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join crew_member_tiers t on t.id = m.tier_id
  where c.slug = p_slug and m.status = 'active'
    and (c.is_public or (select is_crew_member(c.id)))
  order by array_position(array['owner','coach'], m.role),  -- 리더·부리더 먼저
           coalesce(t.sort_order, 99), coalesce(t.name, ''), m.joined_at
  limit least(p_limit, 500);
$$;
grant execute on function public.crew_roster(text, integer) to anon, authenticated;

drop function if exists public.crew_manage_roster(text);
create function public.crew_manage_roster(p_slug text)
returns table(
  user_id uuid, display_name text, email text, role text, status text,
  joined_at timestamptz, tier_id uuid, tier_name text, tier_color text
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), u.email::text, m.role, m.status,
         m.joined_at, t.id, t.name, t.color
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_member_tiers t on t.id = m.tier_id
  where c.slug = p_slug and ((select is_crew_staff(c.id)) or (select is_admin()))
  order by case m.status when 'pending' then 0 else 1 end,
           array_position(array['owner','coach'], m.role),
           coalesce(t.sort_order, 99), coalesce(t.name, ''), m.joined_at;
$$;
grant execute on function public.crew_manage_roster(text) to authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare n int;
begin
  -- 모든 활성 멤버에게 등급이 붙어야 한다
  select count(*) into n from public.crew_members where tier_id is null;
  if n > 0 then raise exception '가드: 등급이 없는 멤버 %건', n; end if;

  -- role 과 등급이 어긋나면 안 된다 (운영진 제외)
  select count(*) into n
  from public.crew_members m join public.crew_member_tiers t on t.id = m.tier_id
  where m.role in ('member', 'associate')
    and m.role <> case when t.is_full_member then 'member' else 'associate' end;
  if n > 0 then raise exception '가드: 등급과 role 이 어긋난 멤버 %건', n; end if;

  -- 크루마다 기본 등급이 정확히 하나
  select count(*) into n from public.crews c
  where (select count(*) from public.crew_member_tiers t
          where t.crew_id = c.id and t.is_default and t.archived_at is null) <> 1;
  if n > 0 then raise exception '가드: 기본 등급이 하나가 아닌 크루 %건', n; end if;

  if not has_function_privilege('authenticated', 'public.set_crew_tier(text, uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_crew_tier(uuid)', 'execute') then
    raise exception '가드: 등급 RPC 에 execute 가 빠졌습니다';
  end if;
end $$;
