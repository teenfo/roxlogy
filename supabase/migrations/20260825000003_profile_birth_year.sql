-- ============================================================
-- Roxlogy — 프로필 출생연도 (연령그룹 백분위용)
--
-- 벤치마크가 디비전×성별×연령그룹 버킷(scope='age:30-34' 인코딩)까지
-- 실측으로 쌓이므로, 출생연도가 있으면 동연령대 기준 백분위를 보여준다.
-- profiles 는 own-only RLS — 추가 정책 불필요.
-- ============================================================

alter table public.profiles
  add column if not exists birth_year integer
    check (birth_year is null or (birth_year between 1920 and 2020));
