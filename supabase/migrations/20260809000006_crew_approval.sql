-- 크루 생성 개방 + 관리자 승인 게이트.
-- 신규 크루는 pending 으로 생성되고, 관리자가 승인(active)해야 목록·가입에 노출된다.

alter table public.crews add column if not exists status text not null default 'active'
  check (status in ('pending','active','rejected'));

-- 신규 생성은 pending 강제 (관리자는 즉시 active 허용)
drop policy if exists crews_insert_auth on public.crews;
create policy crews_insert_auth on public.crews
  for insert with check (
    auth.uid() is not null and created_by = auth.uid()
    and (status = 'pending' or is_admin())
  );

-- status 변경은 관리자만 — 소유자(스태프) 자가 승인 차단
create or replace function public.crews_guard_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from old.status and not is_admin() then
    raise exception 'only admin can change crew status';
  end if;
  return new;
end;
$$;
drop trigger if exists crews_status_guard on public.crews;
create trigger crews_status_guard before update on public.crews
  for each row execute function public.crews_guard_status();

-- 탐색 목록: 활성(승인된) 크루만
create or replace function public.crew_directory(p_limit integer default 50)
returns table(
  slug text, name text, tagline text, logo_url text, location text,
  join_policy text, member_count bigint, post_count bigint
)
language sql stable security definer set search_path to 'public' as $$
  select c.slug, c.name, c.tagline, c.logo_url, c.location, c.join_policy,
         (select count(*) from crew_members m where m.crew_id = c.id and m.status = 'active'),
         (select count(*) from crew_posts p where p.crew_id = c.id and p.deleted_at is null)
  from crews c
  where c.is_public and c.status = 'active'
  order by 7 desc, c.created_at asc
  limit least(coalesce(p_limit, 50), 100);
$$;

-- 개요: 활성이 아니면 소유자·관리자만 조회. crew_status 컬럼 추가(반환형 변경 → 재생성)
drop function if exists public.crew_overview(text);
create function public.crew_overview(p_slug text)
returns table(
  id uuid, slug text, name text, tagline text, description text,
  logo_url text, cover_url text, location text, home_gym text, links jsonb,
  member_count bigint, post_count bigint, upcoming_count bigint,
  my_role text, my_status text, crew_status text
)
language sql stable security definer set search_path to 'public' as $$
  select c.id, c.slug, c.name, c.tagline, c.description,
         c.logo_url, c.cover_url, c.location, c.home_gym, c.links,
         (select count(*) from crew_members m where m.crew_id = c.id and m.status = 'active'),
         (select count(*) from crew_posts p where p.crew_id = c.id and p.deleted_at is null),
         (select count(*) from crew_events e
            where e.crew_id = c.id and e.cancelled_at is null and e.starts_at >= now()),
         (select m.role from crew_members m where m.crew_id = c.id and m.user_id = auth.uid()),
         (select m.status from crew_members m where m.crew_id = c.id and m.user_id = auth.uid()),
         c.status
  from crews c
  where c.slug = p_slug and (
    (c.status = 'active' and (c.is_public or is_crew_member(c.id)))
    or c.created_by = auth.uid()
    or is_admin()
  );
$$;
grant execute on function public.crew_overview(text) to anon, authenticated;

-- 가입: 승인된 크루만
create or replace function public.join_crew(p_slug text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_policy text; v_status text; v_cstatus text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select id, join_policy, status into v_crew, v_policy, v_cstatus from crews where slug = p_slug;
  if v_crew is null then raise exception '크루를 찾을 수 없습니다'; end if;
  if v_cstatus <> 'active' then raise exception '아직 승인되지 않은 크루입니다'; end if;
  v_status := case when v_policy = 'open' then 'active' else 'pending' end;
  insert into crew_members(crew_id, user_id, role, status)
  values (v_crew, auth.uid(), 'member', v_status)
  on conflict (crew_id, user_id) do nothing;
  return v_status;
end;
$$;
grant execute on function public.join_crew(text) to authenticated;
