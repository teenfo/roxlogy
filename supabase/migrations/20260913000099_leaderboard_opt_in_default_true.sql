-- ============================================================
-- Roxlogy — 리더보드 표시를 기본 켬으로
--
-- leaderboard_opt_in 은 2026-07-08(마이그레이션 007)에 `default false` 로 들어왔다.
-- 그래서 가입만 하고 설정을 건드리지 않은 사람은 리더보드에 아예 안 보였고,
-- 실제로 35명 중 26명이 그 상태였다 — 리더보드가 비어 보이는 주된 이유였다.
--
-- 1) 기본값을 true 로 바꾼다 (handle_new_user 는 id·display_name 만 넣으므로
--    새 가입자는 이 기본값을 그대로 받는다).
-- 2) 기존 사용자도 전부 켠다.
--
-- 주의: 이 플래그를 보는 RPC 중 leaderboard_overall·leaderboard_station·
-- pft_leaderboard·discover_members·public_profile 은 anon 에도 execute 가 있다.
-- 즉 켜면 그 사람의 이름·기록이 비로그인 API 로도 조회된다(화면은 로그인 뒤이지만).
-- 끄고 싶은 사람은 설정 > 프로필에서 언제든 다시 끌 수 있다.
-- ============================================================

alter table public.profiles
  alter column leaderboard_opt_in set default true;

update public.profiles
   set leaderboard_opt_in = true
 where not leaderboard_opt_in;

-- 가드 ----------------------------------------------------------------------
do $$
declare v_off int; v_default text;
begin
  select count(*) into v_off from public.profiles where not leaderboard_opt_in;
  if v_off <> 0 then
    raise exception '가드: 아직 꺼져 있는 프로필이 %건', v_off;
  end if;

  select column_default into v_default
    from information_schema.columns
   where table_schema='public' and table_name='profiles'
     and column_name='leaderboard_opt_in';
  if v_default is distinct from 'true' then
    raise exception '가드: 기본값이 true 가 아니다 (%)', coalesce(v_default,'(null)');
  end if;
end $$;
