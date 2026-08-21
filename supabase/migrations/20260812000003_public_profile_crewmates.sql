-- ============================================================
-- Roxlogy — 공개 프로필 노출 조건 확장
--
-- 기존: 공유 세션 보유 또는 리더보드 옵트인 사용자만 public_profile 반환.
-- 신규 가입자가 크루에 조인하면 멤버 목록에서 이름이 링크되는데, 활동이
-- 없어 /u/{id} 가 404 로 떨어졌다. 크루를 함께 쓰는 사이는 서로 표시명을
-- 볼 수 있어야 하므로 두 조건을 추가한다:
--   1. 본인 (p_user = auth.uid())
--   2. 조회자와 같은 크루의 활성 멤버
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
      p_user = auth.uid()
      or exists (select 1 from sessions s
        where s.user_id = p_user and s.shared and s.deleted_at is null)
      or coalesce(pr.leaderboard_opt_in, false)
      or exists (
        select 1
        from crew_members me
        join crew_members them on them.crew_id = me.crew_id
        where me.user_id = auth.uid() and me.status = 'active'
          and them.user_id = p_user and them.status = 'active'
      )
    );
$$;
