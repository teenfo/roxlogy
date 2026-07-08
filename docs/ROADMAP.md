# Roxlogy 개발 로드맵

> 2026-07-08 수립. 상세 기획은 `PLANNING.md`, 핵심 규칙은 루트 `CLAUDE.md` 참조.
> 원칙: 데이터 토대(수신 API·분석 워커)를 먼저 완성하고 워치/폰 네이티브로 확장한다.

## 현재 상태 (완료)

- **웹 (Vercel, roxlogy.com)**: 인증(이메일+구글), 세션 히스토리/상세/수동입력/수정,
  레이스 등록(공식 결과 검색·Race Replay 24구간 가져오기·세션 변환·파트너 이름 검색),
  훈련 대비 비교, 페이싱 등급(S15), 목표 스플릿 계산기(/predict), 대회 일정(/events),
  운동 DB 뷰어, 다국어(en/ko/es)
- **DB (Supabase)**: 마이그레이션 001–004 — 전체 스키마 + RLS(조인 정책) +
  멱등 업서트/LWW/soft delete + session_metrics + race_events
- **인프라**: Vercel 자동 배포(main), Cloudflare DNS, GitHub Actions 프로브 워크플로

## 마일스톤

### M3 — S2 세션 수신 API (데이터 토대 A) ← 진행 중
워치/폰의 전제 조건. 웹 수동입력이 이미 쓰는 계약(003)을 공식 API로 승격.

1. API 계약 문서 `docs/API_CONTRACT.md` — `POST /functions/v1/ingest-session`
   요청/응답 스키마, 에러 코드, 멱등 규칙, LWW 가드, soft delete 동기화
2. 결정 확정: raw 원본 1Hz 보존 / 곡선용 파생은 세그먼트당 ≤120pt(LTTB, 워커 생성) /
   페이로드 상한 요청당 2MB·세션당 erg 샘플 30,000개 / 워치 오프라인 보관 20세션·72h
3. Edge Function `supabase/functions/ingest-session/` — JWT 본인 검증, 페이로드 검증,
   멱등 업서트(+LWW 가드), `analysis_status='pending'` 마킹
4. 정리: `web/app/api/races/search-meta`의 개발용 debug/try/jsurl 모드 제거

### M4 — S5 hosub 분석 워커 (데이터 토대 B)
- `worker/` 신규 (Python + Docker). **outbound pull 전용** — 인바운드 포트 금지,
  service role 키는 hosub 환경변수로만
- 루프: `analysis_status='pending'` 폴링 → `web/lib/analysis.ts` 산식 이식으로
  `session_metrics`/`segment_metrics` 계산 → erg raw 있으면 곡선 다운샘플(LTTB) →
  `analysis_status='done'`
- 웹은 워커 결과 우선 표시, 없으면 기존 즉석 계산 폴백

### M5 — 웹 잔여 고도화 (M3·M4와 병행 가능)
- S3: 운동 DB 360+ 시드 확충 (카테고리·장비 필터)
- S14: 목표 달성 확률 티어 + `goal_plans` 테이블(마이그레이션 005) + 저장 UI
- S16: 훈련→레이스 상관 — 레이스 여러 건 vs 훈련 추이 시계열 차트
- S17: 레이스 시뮬 리허설 리포트 — goal_plans 목표 대비 실측 세션 비교
- S6 잔여: 워커 곡선 데이터 기반 파워/페이스 차트 (M4 이후)

### M6 — 워치 앱 (Wear OS, Kotlin + Wear Compose)
- `android/` 하위 `:wear` + `:shared` 모듈, PM5 BLE(C2 BLE/CSAFE) raw 수집,
  레이스 시뮬 세그먼트 기록, 오프라인 보관(M3 확정 한도), Data Layer 전송
- 착수 조건: M3 배포 + 계약 문서 확정

### M7 — 폰 앱 (Android, Kotlin + Compose)
- `:app` 모듈: Data Layer 수신 → ingest-session 업로드(재시도 큐),
  세션 열람은 웹 딥링크 우선

### M8 — Phase 2 (우선순위 확정: S8 → S13 → S9 → S10)
1. **S8 리더보드**: 서비스 사용자 간 스테이션/디비전 순위 (옵트인 + 공개 뷰)
2. **S13 백분위 랭킹**: `race_benchmarks` 테이블. **게이트 = 공식 결과 대량 수집
   법적 검토** — 그 전에는 공개 익명화 데이터셋(Kaggle S4–6) 분포로 시작
3. **S9 프로그램 빌더**: programs/program_days/workout_templates 스키마 기활용
4. **S10 커뮤니티**: 세션 공유 링크(옵트인) → 팔로우 피드
- 카카오 OAuth: 도입하지 않음 (2026-07-08 결정 — 이메일+구글 유지)

## 게이트/결정 항목
- [ ] Roxlogy 상표 정밀검색(KIPRIS 등) — 스토어 출시(M6/M7) 전
- [ ] S13 공식 결과 수집 법적 검토 — M8-2 착수 전
- hosub GPU/로컬 LLM(S11 AI 코칭)은 Phase 2 후반 TBD
