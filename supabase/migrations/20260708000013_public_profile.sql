-- ============================================================
-- Roxlogy — 013 공개 프로필 (public_profile)
--
-- profiles는 본인만 읽기(own RLS)이므로, 타인의 표시명/디비전을 안전하게
-- 노출하려면 security definer 함수로 최소 정보만 제공한다.
-- "공개" 조건: 공유 세션이 하나라도 있거나 리더보드 옵트인한 사용자만.
-- (그 외 사용자는 행이 반환되지 않아 프로필 페이지가 비공개 처리된다.)
-- ============================================================

create or replace function public.public_profile(p_user uuid)
returns table(
  display_name       text,
  division           text,
  shared_count       bigint,
  leaderboard_opt_in boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pr.display_name,
    pr.division,
    (select count(*) from sessions s
       where s.user_id = p_user and s.shared and s.deleted_at is null),
    coalesce(pr.leaderboard_opt_in, false)
  from profiles pr
  where pr.id = p_user
    and (
      exists (select 1 from sessions s
        where s.user_id = p_user and s.shared and s.deleted_at is null)
      or coalesce(pr.leaderboard_opt_in, false)
    );
$$;

grant execute on function public.public_profile(uuid) to anon, authenticated;
