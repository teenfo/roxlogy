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

### M3 — S2 세션 수신 API (데이터 토대 A) ✅ 완료
워치/폰의 전제 조건. 웹 수동입력 계약(003)을 공식 API로 승격.
- API 계약 문서 `docs/API_CONTRACT.md`, 마이그레이션 005 `ingest_session` RPC(LWW 가드·
  세그먼트 스냅샷·erg 업서트), Edge Function `ingest-session`(배포됨, JWT 본인 검증).
- search-meta 개발용 debug/try/jsurl 모드 제거. 라이브 검증 완료(멱등·LWW·소유권·401).

### M4 — S5 hosub 분석 워커 (데이터 토대 B) ✅ 완료
- `worker/` (Python + httpx + Docker). **outbound pull 전용**, service role env로만.
- `analysis_status='pending'` 폴링 → `analyze.py`(analysis.ts 이식)로 지표 계산 →
  erg raw는 LTTB 곡선 다운샘플 → `done`. 선점(compare-and-set)·stale 스위퍼.
- 웹은 워커 결과 우선, 없으면 즉석 계산 폴백. 라이브 검증 완료.

### M5 — 웹 잔여 고도화 ✅ 완료
- S3: 운동 DB 확충 — 시드 04 (총 120종, uuid5 결정적 id) + 장비 필터
- S14: `goal_plans` 테이블(마이그레이션 006) + achievabilityTier + 저장 UI
- S16: CorrelationLine — 시뮬 세션 vs 레이스 총시간 시계열(대시보드)
- S17: 리허설 리포트 — 최신 목표 vs 최신 시뮬 세션 스테이션별 대비(대시보드)
- S6: 워커 곡선 기반 파워/페이스 차트(ErgCurve) — 세션 상세

> 다음: **M6 워치 앱** (M3 배포·계약 확정 완료 — 착수 조건 충족) 또는 **M8 Phase 2**.

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
