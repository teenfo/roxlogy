-- 관리자 기반: is_admin/disabled 플래그 + is_admin() 헬퍼 + admin RLS + 통계 RPC
-- 관리자 접근은 profiles.is_admin 로 판정. 관리자 정책은 기존 소유자 정책과 OR 결합된다.
-- service role은 사용하지 않음 — 관리자도 anon 키 + JWT + RLS로만 접근(클라이언트 안전).

alter table profiles add column if not exists is_admin boolean not null default false;
alter table profiles add column if not exists disabled boolean not null default false;

-- 호출자가 관리자인지 (security definer로 RLS 우회 조회 → 정책 재귀 없음)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- profiles: 전체 조회 + 전체 수정(권한/비활성 토글)
drop policy if exists profiles_admin_select on profiles;
create policy profiles_admin_select on profiles for select using (is_admin());
drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update using (is_admin()) with check (is_admin());

-- sessions: 전체 조회 + 전체 수정(리더보드 제외·soft delete)
drop policy if exists sessions_admin_select on sessions;
create policy sessions_admin_select on sessions for select using (is_admin());
drop policy if exists sessions_admin_update on sessions;
create policy sessions_admin_update on sessions for update using (is_admin()) with check (is_admin());

-- race_results: 전체 조회 + 삭제
drop policy if exists race_results_admin_select on race_results;
create policy race_results_admin_select on race_results for select using (is_admin());
drop policy if exists race_results_admin_delete on race_results;
create policy race_results_admin_delete on race_results for delete using (is_admin());

-- programs: 전체 조회 + 수정(공개 토글) + 삭제
drop policy if exists programs_admin_select on programs;
create policy programs_admin_select on programs for select using (is_admin());
drop policy if exists programs_admin_update on programs;
create policy programs_admin_update on programs for update using (is_admin()) with check (is_admin());
drop policy if exists programs_admin_delete on programs;
create policy programs_admin_delete on programs for delete using (is_admin());

-- exercises: 관리자 쓰기(운동 DB 편집). 읽기는 기존 공개 정책 유지.
drop policy if exists exercises_admin_write on exercises;
create policy exercises_admin_write on exercises for all using (is_admin()) with check (is_admin());

-- 대시보드 통계 (관리자만)
create or replace function public.admin_overview()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not is_admin() then null else json_build_object(
    'users', (select count(*) from profiles),
    'admins', (select count(*) from profiles where is_admin),
    'disabled', (select count(*) from profiles where disabled),
    'sessions', (select count(*) from sessions where deleted_at is null),
    'races', (select count(*) from race_results),
    'programs', (select count(*) from programs),
    'public_programs', (select count(*) from programs where is_public),
    'new_users_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'sessions_7d', (select count(*) from sessions where deleted_at is null and created_at > now() - interval '7 days')
  ) end;
$$;

-- 사용자 목록 + 세션 수 (관리자만)
create or replace function public.admin_users(p_search text default null)
returns table (
  id uuid, display_name text, created_at timestamptz,
  is_admin boolean, disabled boolean, leaderboard_opt_in boolean, session_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.created_at, p.is_admin, p.disabled, p.leaderboard_opt_in,
         (select count(*) from sessions s where s.user_id = p.id and s.deleted_at is null) as session_count
  from profiles p
  where is_admin()
    and (p_search is null or p_search = '' or p.display_name ilike '%' || p_search || '%')
  order by p.created_at desc
  limit 200;
$$;

-- 관리자 지정 (본인 계정)
update profiles set is_admin = true where id = '9321eb2e-eae7-4341-bda2-79a20f869760';
