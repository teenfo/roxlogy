-- 팔로우 대상 찾기: 공개 의사를 밝힌 사용자만 노출
-- (리더보드 옵트인 = true 이거나, 세션을 하나라도 공유한 사용자). 본인·비활성 제외.
-- security definer로 profiles/follows RLS를 우회해 공개 대상만 안전하게 집계한다.
create or replace function public.discover_members(p_search text default null)
returns table (
  id uuid,
  display_name text,
  shared_count bigint,
  follower_count bigint,
  is_following boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         coalesce(p.display_name, 'Athlete') as display_name,
         (select count(*) from sessions s
            where s.user_id = p.id and s.shared and s.deleted_at is null) as shared_count,
         (select count(*) from follows f where f.followee_id = p.id) as follower_count,
         exists (
           select 1 from follows f2
           where f2.follower_id = auth.uid() and f2.followee_id = p.id
         ) as is_following
  from profiles p
  where p.id <> auth.uid()
    and coalesce(p.disabled, false) = false
    and (
      p.leaderboard_opt_in = true
      or exists (
        select 1 from sessions s
        where s.user_id = p.id and s.shared and s.deleted_at is null
      )
    )
    and (p_search is null or p_search = '' or p.display_name ilike '%' || p_search || '%')
  order by follower_count desc, shared_count desc, p.created_at desc
  limit 100;
$$;

revoke all on function public.discover_members(text) from public;
grant execute on function public.discover_members(text) to authenticated;
