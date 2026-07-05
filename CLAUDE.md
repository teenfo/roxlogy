# CLAUDE.md — Roxlogy

> AI 코딩 에이전트(Claude Code / Antigravity)가 매 세션 먼저 읽는 문서.
> 상세 기획은 `docs/PLANNING.md` 참조. 이 파일은 **핵심 규칙과 현재 상태**만 간결히 유지한다.

## 프로젝트 한 줄 정의
**Roxlogy(록솔로지)** — 일반 HYROX 유저 대상 **공개 앱**. Wear OS 네이티브 + Concept2 PM5(스키/로잉) 실시간 raw 연동 + 훈련×레이스 상관 분석 + 한국어 우선이 차별점. **독립 프로젝트**(다른 프로젝트와 자산·인프라 공유 없음).

## 브랜드/네이밍 규칙
- 서비스명 **Roxlogy**, 패키지 `app.roxlogy.android` / `app.roxlogy.wear`, 도메인 1순위 `roxlogy.app`
- 톤: 정밀·테크 + 담백·미니멀. 데이터가 말하게 하고, 과장·허세·마초 클리셰 금지
- 로고(확정): 옐로 8세그먼트 링(최외곽, 스테이션) + 블루 연속 트랙 링(안쪽, 러닝) + 인더스트리얼 R(중앙). 팔레트: Race Yellow #FFD500 / Black #141414 / Track Blue #2D7DFF / Chalk #F4F4F2. 규칙: 옐로 링은 항상 8조각, 블루 링은 절대 끊지 않음
- **"HYROX" 상표를 앱 이름·서브타이틀·패키지명에 쓰지 말 것** (설명문 내 호환성 언급만 허용)

## 현재 Phase
**Phase 1 — 온라인 사이트(데이터 토대) 우선.**
지금 작업 순서: ①Supabase 스키마+RLS 확정 → ②세션 수신 API(멱등 업서트) → ③세션 히스토리/상세 웹 화면 → ④hosub 분석 워커.
워치/폰 네이티브 앱은 데이터 토대 검증 후 착수.

## 기술 스택 (확정 — 임의 변경 금지)
- **워치**: Kotlin + Wear Compose (네이티브). PM5 BLE 직결 때문에 네이티브 강제.
- **폰**: Kotlin + Compose (네이티브). Wearable Data Layer 연동.
- **공유 모듈** `:shared`: 평범한 Kotlin 모듈. (iOS 확장 시 KMP로 승격)
- **웹**: Next.js (Vercel 배포)
- **DB/Auth/Realtime/Storage**: Supabase Cloud
- **공개 API**: Supabase Edge Functions 우선. 복잡한 분석만 FastAPI 추가 검토.
- **분석 워커**: hosub 서버(i7, Ubuntu, Docker). Phase 1은 CPU. GPU/AI 코칭은 Phase 2.

## 데이터 모델 핵심 규칙
- 세션 `id`는 **클라이언트(워치)가 생성한 UUID**. 서버는 `ON CONFLICT (id) DO UPDATE`로 **멱등 업서트**.
- **Source of Truth = 서버(Supabase).** 세션 흐름: 워치 생성 → 폰 경유 → 서버 최종 저장.
- 충돌 정책 = **Last-Write-Wins** (`updated_at` 기준).
- erg raw: `erg_samples.samples`(JSONB)에 **원본 보존**. 파생 지표는 `segment_metrics`에 워커가 계산해 채움.
- 모든 사용자 데이터 테이블은 **RLS 필수**. 세그먼트·raw는 session을 경유한 조인 정책으로 소유권 판정.

## 보안 규칙 (엄수)
- Supabase **service role 키**는 서버/워커(hosub) 내부 시크릿으로만. **클라이언트에 절대 노출 금지.**
- hosub 워커는 **outbound pull**만 (Supabase에 먼저 접속). 인바운드 포트 개방 금지.
- 클라이언트는 anon 키 + RLS로만 접근.

## 디렉토리 구조
```
docs/PLANNING.md         # 전체 기획 (상세)
supabase/migrations/     # SQL 마이그레이션 (스키마+RLS)
supabase/seed/           # 시드 데이터 (운동 DB 등)
web/                     # Next.js 웹앱
.github/workflows/       # CI/CD
```

## 코딩 컨벤션
- 커밋: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:` ...)
- SQL: 마이그레이션은 타임스탬프 프리픽스, 되돌릴 수 있게 작성
- 비밀값: `.env`는 커밋 금지 (`.env.example`만 커밋)

## 하지 말 것 (Do NOT)
- 확정된 기술 스택을 임의로 바꾸지 말 것 (특히 워치를 크로스플랫폼으로 돌리지 말 것)
- 다른 개인 프로젝트(BCL 등)의 자산·인프라를 끌어오지 말 것 — 독립 프로젝트
- service role 키를 프론트엔드/클라이언트 코드에 넣지 말 것
- RLS 없이 사용자 데이터 테이블을 만들지 말 것
- "HYROX" 상표를 앱/패키지명에 직접 쓰지 말 것 (스토어 리젝 위험 — 네이밍 미확정)

## 미해결 결정 (착수 전 확인 필요)
- [ ] RLS 조인 정책 상세 (세그먼트·raw) — **스키마 올리는 시점 즉시 필요**
- [ ] raw 다운샘플링 기준 (곡선 차트용)
- [x] 앱/패키지명 — Roxlogy 확정 (상표 출원 전 정밀검색만 남음)
- [ ] 오프라인 세션 보관 한도 (워치 로컬)
