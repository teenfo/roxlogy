-- ============================================================
-- Roxlogy — 레이스 종료를 보드에 즉시 밀어 주기
--
-- 보드(web/components/pft-race-board.tsx)는 Realtime 을 "다시 읽으라는 신호"로 쓰는데,
-- 지금까지 발행되는 테이블이 pft_race_entries 뿐이었다. 레이스 종료(pft_race_set_status)는
-- pft_races 한 줄만 건드리므로 아무 신호도 가지 않았고, 현장에서 종료를 눌러도 보드가
-- 그대로였다 — 5초 폴링이 있긴 하지만 그 화면의 상단 바는 서버 렌더 값이라 새로고침
-- 전까지 LIVE 로 남았다 (2026-09-13 운영 피드백).
--
-- pft_races 를 발행 목록에 추가한다. 이 테이블의 select 정책은 이미 `true`(누구나 조회)라
-- Realtime 이 새로 열어 주는 정보는 없다 — 같은 행을 지금도 anon 이 읽을 수 있다.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'pft_races'
  ) then
    alter publication supabase_realtime add table public.pft_races;
  end if;
end $$;

-- 가드 ----------------------------------------------------------------------
do $$
declare v_qual text;
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'pft_races'
  ) then
    raise exception '가드: pft_races 가 supabase_realtime 에 실리지 않았다';
  end if;

  -- 공개 조회 테이블이 맞는지 다시 확인한다 — 아니라면 발행이 정보를 새로 여는 셈이다
  select pg_get_expr(polqual, polrelid) into v_qual
    from pg_policy where polrelid = 'public.pft_races'::regclass and polcmd = 'r';
  if v_qual is distinct from 'true' then
    raise exception '가드: pft_races select 정책이 공개가 아니다 (%) — 발행 재검토 필요',
      coalesce(v_qual, '(none)');
  end if;
end $$;
