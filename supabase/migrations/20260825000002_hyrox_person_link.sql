-- ============================================================
-- Roxlogy — HYROX 공식 기록 연동 (person_ref)
--
-- 사용자가 본인 이름 검색으로 자신의 공식 기록임을 확인하면 person_ref
-- (Result API 의 인물 식별자)를 프로필에 저장한다. 주간 배치가 이 ref 로
-- 새 레이스 결과를 감지해 race_results 에 자동 임포트하고 알림을 남긴다.
-- 본인이 명시적으로 연결한 경우만 조회한다 (S12 원칙 유지).
-- profiles 는 own-only RLS 이므로 추가 정책 불필요.
-- ============================================================

alter table public.profiles
  add column if not exists hyrox_person_ref text,
  add column if not exists hyrox_athlete_name text;
