# 전체 화면 적용 대응표

2026-09-20 · 원본 앱의 `page.tsx` **68개** 기준. 대시보드만의 시안이 아니라 실제 라우트/공유 컴포넌트에 적용했다.

각 페이지는 리뉴얼 공통 토큰·폰트·컨트롤을 사용한다. 인증된 앱/크루/대회/예측 화면은 사이드바·모바일 내비게이션을 공유한다. 아래 표의 파일이 폼 컴포넌트를 반환하는 경우 실제 스타일은 해당 공유 컴포넌트에 적용되어 있다.

| 경로 | 실제 소스 | 화면 구조 | 로딩 형태 |
| --- | --- | --- | --- |
| `/admin/content` | `web/app/(app)/admin/content/page.tsx` | 관리자 목록·상세·실제 관리 컨트롤 | `adminDetail` |
| `/admin/crews` | `web/app/(app)/admin/crews/page.tsx` | 관리자 목록·상세·실제 관리 컨트롤 | `adminDetail` |
| `/admin/moderation` | `web/app/(app)/admin/moderation/page.tsx` | 관리자 목록·상세·실제 관리 컨트롤 | `adminDetail` |
| `/admin` | `web/app/(app)/admin/page.tsx` | 관리자 목록·상세·실제 관리 컨트롤 | `adminDetail` |
| `/admin/races` | `web/app/(app)/admin/races/page.tsx` | 관리자 목록·상세·실제 관리 컨트롤 | `adminDetail` |
| `/admin/users/[id]` | `web/app/(app)/admin/users/[id]/page.tsx` | 관리자 목록·상세·실제 관리 컨트롤 | `adminDetail` |
| `/admin/users` | `web/app/(app)/admin/users/page.tsx` | 관리자 목록·상세·실제 관리 컨트롤 | `adminDetail` |
| `/dashboard` | `web/app/(app)/dashboard/page.tsx` | KPI·최근 레이스·기록/일정·분석 | `dashboard` |
| `/exercises/[id]` | `web/app/(app)/exercises/[id]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `exercise` |
| `/exercises` | `web/app/(app)/exercises/page.tsx` | 공통 목록/카탈로그·필터·상태 | `exercise` |
| `/feed` | `web/app/(app)/feed/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/goals` | `web/app/(app)/goals/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/insights` | `web/app/(app)/insights/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/leaderboard` | `web/app/(app)/leaderboard/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/members` | `web/app/(app)/members/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/notifications` | `web/app/(app)/notifications/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/pft/[id]/edit` | `web/app/(app)/pft/[id]/edit/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/pft/leaderboard` | `web/app/(app)/pft/leaderboard/page.tsx` | 공통 목록/카탈로그·필터·상태 | `pft` |
| `/pft/measure` | `web/app/(app)/pft/measure/page.tsx` | 공통 목록/카탈로그·필터·상태 | `pft` |
| `/pft/new` | `web/app/(app)/pft/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/pft` | `web/app/(app)/pft/page.tsx` | 공통 목록/카탈로그·필터·상태 | `pft` |
| `/pft/race/[code]` | `web/app/(app)/pft/race/[code]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `pft` |
| `/pft/race/[code]/staff` | `web/app/(app)/pft/race/[code]/staff/page.tsx` | PftRaceStaff: 웨이브·선수 카드 | `staff` |
| `/pft/race/join` | `web/app/(app)/pft/race/join/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/pft/race/new` | `web/app/(app)/pft/race/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/pft/race` | `web/app/(app)/pft/race/page.tsx` | 공통 목록/카탈로그·필터·상태 | `pft` |
| `/programs/[id]` | `web/app/(app)/programs/[id]/page.tsx` | 계획 상세·빌더·멤버 미리보기 | `programDetail` |
| `/programs/new` | `web/app/(app)/programs/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/programs` | `web/app/(app)/programs/page.tsx` | 공통 목록/카탈로그·필터·상태 | `programList` |
| `/races/[id]` | `web/app/(app)/races/[id]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `raceDetail` |
| `/races/new` | `web/app/(app)/races/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/races` | `web/app/(app)/races/page.tsx` | 공통 목록/카탈로그·필터·상태 | `raceList` |
| `/runs/[id]/edit` | `web/app/(app)/runs/[id]/edit/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/runs/new` | `web/app/(app)/runs/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/runs` | `web/app/(app)/runs/page.tsx` | 공통 목록/카탈로그·필터·상태 | `run` |
| `/schedule` | `web/app/(app)/schedule/page.tsx` | 공통 목록/카탈로그·필터·상태 | `schedule` |
| `/schedule/race/[id]` | `web/app/(app)/schedule/race/[id]/page.tsx` | 내 레이스 계획: BIB·목표·파트너 | `racePlan` |
| `/search` | `web/app/(app)/search/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/sessions/[id]/edit` | `web/app/(app)/sessions/[id]/edit/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/sessions/[id]` | `web/app/(app)/sessions/[id]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `sessionDetail` |
| `/sessions/compare` | `web/app/(app)/sessions/compare/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/sessions/new` | `web/app/(app)/sessions/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/sessions` | `web/app/(app)/sessions/page.tsx` | 공통 목록/카탈로그·필터·상태 | `sessionList` |
| `/settings/profile` | `web/app/(app)/settings/profile/page.tsx` | 설정: 프로필·MCP·푸시 카드 | `profile` |
| `/u/[id]` | `web/app/(app)/u/[id]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `profile` |
| `/workouts/[id]` | `web/app/(app)/workouts/[id]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `workout` |
| `/auth/native` | `web/app/auth/native/page.tsx` | 브랜드 인증 진행·실패 상태 | `공통 경계` |
| `/board/[code]` | `web/app/board/[code]/page.tsx` | PftRaceBoard: 독립 다크 3단 | `board` |
| `/crews/[slug]/board/[postId]/edit` | `web/app/crews/[slug]/board/[postId]/edit/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/crews/[slug]/board/[postId]` | `web/app/crews/[slug]/board/[postId]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewBoard` |
| `/crews/[slug]/board/new` | `web/app/crews/[slug]/board/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/crews/[slug]/board` | `web/app/crews/[slug]/board/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewBoard` |
| `/crews/[slug]/finance` | `web/app/crews/[slug]/finance/page.tsx` | 회계: KPI·회비/장부·우측 보조 패널 | `finance` |
| `/crews/[slug]/leaderboard` | `web/app/crews/[slug]/leaderboard/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewDetail` |
| `/crews/[slug]/manage` | `web/app/crews/[slug]/manage/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewDetail` |
| `/crews/[slug]/members` | `web/app/crews/[slug]/members/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewDetail` |
| `/crews/[slug]` | `web/app/crews/[slug]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewDetail` |
| `/crews/[slug]/schedule/[eventId]` | `web/app/crews/[slug]/schedule/[eventId]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewDetail` |
| `/crews/[slug]/schedule` | `web/app/crews/[slug]/schedule/page.tsx` | 공통 상세 패널·기록·컨트롤 | `crewDetail` |
| `/crews/new` | `web/app/crews/new/page.tsx` | 공통 생성/편집 폼·요약·저장 | `form` |
| `/crews` | `web/app/crews/page.tsx` | 공통 목록/카탈로그·필터·상태 | `crewList` |
| `/download` | `web/app/download/page.tsx` | 공통 목록/카탈로그·필터·상태 | `공통 경계` |
| `/events/[id]` | `web/app/events/[id]/page.tsx` | 공통 상세 패널·기록·컨트롤 | `racePlan` |
| `/events` | `web/app/events/page.tsx` | 공통 목록/카탈로그·필터·상태 | `raceList` |
| `/login` | `web/app/login/page.tsx` | AuthForm: 브랜드/폼 2단 | `공통 경계` |
| `/` | `web/app/page.tsx` | 랜딩: 브랜드 히어로·데모·기능·크루 티커 | `공통 경계` |
| `/predict` | `web/app/predict/page.tsx` | 공통 목록/카탈로그·필터·상태 | `form` |
| `/signup` | `web/app/signup/page.tsx` | AuthForm: 브랜드/폼 2단 | `공통 경계` |

## 페이지 밖의 누락 항목

| 항목 | 실제 구현 |
| --- | --- |
| 404 | `web/app/not-found.tsx`, 원본 마크·404·홈 |
| 에러 경계 | `web/app/error.tsx`, `web/app/global-error.tsx`, `components/error-screen.tsx` |
| 22개 스켈레톤 | `components/skeleton.tsx`, 각 라우트의 `loading.tsx` |
| 정지/로그인/모임/회계/프로필 권한 | 기존 서버 권한 조건 + 통일된 상태 패널 |
| 모바일 하단 탭·시트·Watch | `mobile-tabbar.tsx`, 실제 native bridge 분기 유지 |
| 자체 Dialog/Sheet | `components/ui/dialog.tsx`, 명시적 닫기·85dvh·모바일 시트 |
| 기록지 합성 | `lib/record-card.ts`, `record-card-button.tsx`, Archivo Black·원본 마크 |
| ko/en/es | 기존 전체 사전 및 새 내비게이션·로딩 번역 |
| 프로그램 preview=1 | 복제 표시, 소유자 편집/삭제/토큰 재발급 숨김, 내 등록 유지 |
| Google One Tap | 기존 FedCM/SDK + 실패 시 Google 버튼 안내. 브라우저 UI를 재제작하지 않음 |
| OG 공유물 | 공통 정적·공개 크루·공개 모임, 다크 브랜드·익명 공개 데이터 |

## 검증 결과

68개 페이지 + 10개 상태/로케일, 총 **78/78 서버 렌더 검증 통과**. 기존 회귀 테스트 **22/22 통과**. 상세 한계와 근거는 `ROXLOGY-Validation.md` 참조.

## 재현 가능한 검증

`web`에서 기존 의존성을 설치한 후:

```sh
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-dummy-anon-key npm run build
npm run typecheck
npm run lint
npm run test:design-gaps
npm run test:renewal-http
```

HTTP 검증은 127.0.0.1:54321의 테스트 서버와 127.0.0.1:18088의 실제 Next.js production 서버를 사용한다. 테스트용 사용자·기록은 `tests/fixtures/renewal-db.mjs`에만 존재하며 앱에 import되지 않는다. `offline-network-guard.mjs`가 로컬 픽스처 외 fetch를 호출 전에 차단한다. 운영 자격 증명·DB·실제 계정을 사용하지 않는다. 테스트 결과와 HTML은 `/tmp/roxlogy-renewal-qa`에 생성된다.

테스트는 각 라우트의 응답·서버 렌더 오류, 미리보기의 실제 컨트롤, 회계의 두 탭과 비회원 데이터 차단, 권한 안내, 다국어 렌더를 확인한다. 실서비스 OAuth·푸시·네이티브·실시간 다중 기기 계측 성공을 검증하는 테스트는 아니다.

실제 브라우저의 로컬 접속 차단으로 모바일/데스크톱 픽셀·터치·포커스·실시간 동작은 이번 환경에서 검증하지 못했다. 이를 서버 렌더 통과와 혼동하지 않는다.
