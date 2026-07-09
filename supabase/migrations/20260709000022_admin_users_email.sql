-- 관리자 사용자 목록에 이메일 포함 (auth.users 조인). 반환 타입 변경이라 drop 후 재생성.
drop function if exists public.admin_users(text);
create function public.admin_users(p_search text default null)
returns table (
  id uuid, display_name text, email text, created_at timestamptz,
  is_admin boolean, disabled boolean, leaderboard_opt_in boolean, session_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, u.email::text, p.created_at,
         p.is_admin, p.disabled, p.leaderboard_opt_in,
         (select count(*) from sessions s where s.user_id = p.id and s.deleted_at is null) as session_count
  from profiles p
  left join auth.users u on u.id = p.id
  where is_admin()
    and (p_search is null or p_search = ''
         or p.display_name ilike '%' || p_search || '%'
         or u.email ilike '%' || p_search || '%')
  order by p.created_at desc
  limit 200;
$$;
