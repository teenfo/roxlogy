-- 크루 탐색(/crews) 목록 — 공개 크루만, 멤버·글 수 포함. anon 열람 가능.
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
  where c.is_public
  order by 7 desc, c.created_at asc
  limit least(coalesce(p_limit, 50), 100);
$$;

grant execute on function public.crew_directory(integer) to anon, authenticated;
