# Roxlogy

**Roxlogy(록솔로지)** — Rox + -logy, "하이브리드 레이스를 데이터로 연구하다".
Wear OS 네이티브 + Concept2 PM5 raw 연동 + 훈련×레이스 상관 분석을 차별점으로 하는 HYROX 훈련·분석 공개 앱.

## 구성
- **워치 (Wear OS)** — 훈련 실행, PM5 BLE 직결, 타이머/트랜지션
- **폰 (Android)** — 프로그램 관리, 동기화 브릿지
- **웹 (Next.js)** — 계정/저장/분석 (Source of Truth)
- **분석 워커 (hosub)** — raw erg → 파생 지표 계산

## 문서
- 전체 기획: [`docs/PLANNING.md`](docs/PLANNING.md)
- AI 에이전트 규칙: [`CLAUDE.md`](CLAUDE.md)

## 개발 시작 (Phase 1 — 데이터 토대)
1. Supabase Cloud 프로젝트 생성
2. `supabase/migrations/`의 SQL을 순서대로 적용 (스키마 → RLS)
3. `supabase/seed/`로 운동 DB 시드
4. `web/`에서 Next.js 앱 개발

자세한 순서는 `docs/PLANNING.md` §8, `CLAUDE.md`의 "현재 Phase" 참조.

## 라이선스
Private (미정)
