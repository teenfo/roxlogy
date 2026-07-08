-- ============================================================
-- Roxlogy — 010 훈련 로그 강화 (세션 메모 + 컨디션/RPE)
--
-- sessions에 주관적 훈련 로그 필드 추가. 본인 데이터이며 기존 sessions RLS
-- (본인 소유)로 접근이 통제된다. 공유(shared) 세션은 shared-read 정책으로
-- 행 전체가 팔로워에게 읽힐 수 있으므로, notes/rpe는 UI에서 소유자에게만
-- 노출한다(개인 메모 보호). 정식 컬럼 단위 통제는 추후 필요 시 도입.
-- ============================================================

alter table public.sessions
  add column if not exists notes text,
  add column if not exists rpe smallint check (rpe is null or (rpe between 1 and 10));
