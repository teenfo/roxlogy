# 리뉴얼 시안 전면 이식 계획 (PORT_PLAN)

> 2026-09-20. 브랜치 `claude/design-renewal`. 착수 전 승인 대기.
> 지시: **"업로드한 디자인을 그대로 적용. 글로벌 브랜드 자산만 유지하고 모든 디자인을 개편 — 네비게이션까지."**

## 0. 진단 — 지금까지 한 것과 부족한 것

브랜치의 12개 커밋은 **토큰(색·치수)·셸 골격·공통 계약·시스템 상태 화면**을 스펙 문서(§01–§21)
기준으로 맞춘 것이다. 시안 소스(`roxlogy-renewal/source`)의 **화면 자체는 옮기지 않았다.**
그래서 프리뷰에서는 배경이 밝아지고 사이드바가 생긴 정도로만 보인다.

| 커밋 | 한 것 | 이번 계획에서 |
|---|---|---|
| f359b97 docs · 66ccd7a 하네스 · a2ae88a 픽스처 | 지침 문서, 68 라우트 캡쳐 하네스 | **유지** — 검증 도구 |
| 57639f7 토큰화 380곳 | 임의 hex → CSS 변수 | **유지** — 변수 이름만 시안 것으로 재매핑 |
| 1069ff1 라이트 테마 | `:root` 값 교체, `.theme-dark` 섬 | **대체** — 시안 `globals.css` 의 `:root` 로 |
| 20f357d 사이드바 · 90aa337 계약 · 3721260 · 7cbeafc | 우리 식으로 만든 셸·PageHead·Panel 등 | **대체** — 시안 `rox-app.tsx`·`ui.tsx` 로 |
| f76c09a 오류·게이트·다이얼로그 · 47b5a23 스켈레톤·네이티브 | 우리 마크업으로 만든 상태 화면 | **대체** — 시안 `public-screens.tsx`·`loading-states.tsx` 로. 라우트 파일·i18n 키는 유지 |

시안은 **완성된 화면 코드**다 — 라우트별 컴포넌트 32개(`components/rox/*.tsx` 14,328줄),
전용 스타일 `globals.css` 5,208줄(`.rx-*` 클래스 약 300개), shadcn 프리미티브 15종.
따라서 이번 계획은 "스펙을 해석해 우리 화면을 고치는 것"이 아니라 **시안 코드를 옮겨 오고
데이터만 우리 것으로 갈아 끼우는 것**이다.

## 1. 원칙

### 1-a. 시안에서 그대로 가져오는 것

| 항목 | 시안 파일 | 가져오는 방식 |
|---|---|---|
| 스타일 전체 | `app/globals.css` (5,208줄) + `vendor/shadcn-tailwind-4.13.0.css` | `web/app/globals.css` 를 **통째로 교체**. `.rx-*` 클래스 이름·값 그대로. 브랜드 예외(1-b)만 손댄다 |
| 셸·네비게이션 | `rox-app.tsx` · `mobile-navigation.tsx` | `components/rox/app-shell.tsx` 로 이식. 사이드바(15.5rem, 3그룹 14항목, 푸터에 내 크루+프로필) · 상단바(`SidebarTrigger` + `MY WORKSPACE` + 언어·검색·알림·아바타) · `rx-main` · `rx-footer` · 모바일 하단 5탭 + 바텀시트 |
| 공통 계약 | `ui.tsx` (Panel·PageHead·Go·Back·Chip·Choice·Find·Segments·NavTabs·DataTable·Empty·Stats·Field·Hint·RowLink·ProgressBar) | `components/rox/ui.tsx` 로 이식. 우리가 만든 `app-ui.tsx`·`app-filters.tsx` 는 삭제 |
| 프리미티브 | `components/ui/` 중 실제 사용 15종: button · input · textarea · checkbox · switch · select · tabs · table · progress · empty · skeleton · sidebar(+sheet·separator·tooltip 의존) · sonner · alert-dialog · dialog | `components/ui/` 에 추가. 나머지 60여 개는 가져오지 않는다 |
| 아이콘 | `lucide-react` | 의존성 추가. 우리 `nav-icon.tsx` SVG 세트는 사이드바에서 빠진다 |
| 화면 32종 | `dashboard.tsx` · `records.tsx` · `training.tsx` · `racing.tsx` · `crew.tsx` · `finance.tsx` · `account.tsx` · `pft-race.tsx` · `public-screens.tsx` · `completion-*.tsx` · `record-card.tsx` | §3 매핑표대로 **마크업·클래스·구성을 그대로** 옮기고, 데모 데이터 자리에 우리 쿼리 결과를 넣는다 |
| 상태 화면 | `loading-states.tsx`(22 스켈레톤) · `ErrorScreen` · `NotFoundScreen` · `GateScreen` 5종 · `NativeAuth` 4상태 · `WatchScreen` | 그대로 |
| 다이얼로그 | `dialog.tsx` (`RoxDialog` 어댑터) + `.rx-custom-dialog`·`.rx-custom-sheet`·`.rx-dialog-handle` | 시안의 `custom-dialog.tsx` 는 **우리 `components/ui/dialog.tsx` 의 복사본**이다(주석에 명시). 우리 것을 두고 어댑터만 추가 |

추가 의존성: `lucide-react` · `radix-ui` · `class-variance-authority` · `clsx` · `tailwind-merge` ·
`sonner` · `tw-animate-css`. **넣지 않는 것**: `next-themes`(라이트 단일이라 sonner 의 `useTheme` 호출만 제거),
`vaul`·`react-hook-form`·`@hookform/resolvers`·`cmdk`·`date-fns`·`drizzle`·`embla`(시안에서도 미사용 또는 스타터 잔재).
`recharts`·`zod` 는 이미 있다. 시안의 폰트 스택도 Pretendard 우선이라 우리 자체 호스팅 그대로 맞는다.

### 1-b. 브랜드 자산 — 유일한 예외

| 시안 | 우리 값 | 위치 |
|---|---|---|
| `.rx-brand` 노란 사각 이탤릭 `R.` | `brand/roxlogy-mark.svg` 링 마크 + `ROXLOGY` 워드마크(Archivo Black) | 사이드바 헤더 · `.rx-public-brand`(공개 헤더·푸터) · `.rx-live-brand`(라이브보드) · 인증 카드 |
| `--primary #EFCF20` · `.rx-primary #EFD126` · `.rx-chip.yellow` 계열 | `#FFD500` (글자 `#25282D` 유지) | `:root` 한 곳 |
| `.rx-crew-mark` 글자 `#EFCF20` · 사이드바 활성 `inset 3px 0 #DFC026` · `.rx-race-split` 첫 조각 `#ecd84a` | `#FFD500` | 각 규칙 |
| 파비콘 `favicon.svg`(시안 것) | 우리 `roxlogy-appicon.svg` | `app/layout.tsx` |
| 기록지 카드 팔레트 | `lib/record-card.ts` — **시안과 파일이 동일**(diff 0) | 변경 없음 |

그 외 색은 시안 값 그대로다 — `--sidebar-accent #FFF7CC`, 차트 5색, 수입 `#448369`/지출 `#B56B66`,
라이브보드 `#12171C`/`#181F26`, 레이스 패널 `#222930`/`#252D34`, 스테이지 6색.
옐로를 밝은 면 텍스트로 쓰지 않는 규칙(1.42:1)은 그대로 지킨다 — 시안도 그렇게 돼 있다.

### 1-c. 우리 것을 유지하는 것 (디자인이 아닌 것)

- **App Router 서버 컴포넌트 + 실제 데이터.** 시안은 `views.tsx` 클라이언트 라우터 + `data.ts` 데모다.
  라우트 파일 구조(`app/(app)/…`, `app/crews/[slug]/…`)와 `page.tsx` 의 Supabase 조회는 그대로 두고
  **JSX 만 시안 마크업으로 바꾼다.** `Promise.all`·N+1 금지·`user_id` 필터·`error` 확인 규칙 그대로.
- **인증·권한.** 로그인 리다이렉트, `is_admin`, 크루 등급, RLS. 시안의 "미리보기 상태 선택기"(`rx-state-selector`)와
  `PreviewProvider`·`/design-coverage` 갤러리는 **가져오지 않는다.**
- **탐색.** 시안 `navigation.tsx` 는 일반 `<a>` 전체 이동이다. 우리는 `next/link` 와 목록 행의 `RowLink`(프리페치 제어)를 유지.
  시안 `ui.tsx` 의 `RowLink`(기록 행 UI)는 이름이 겹치므로 **`RecordRow`** 로 들여온다.
- **i18n.** 시안 `useLocale.t()` 는 우리 `useI18n().t()` / `getT()` 로 치환. 시안이 한국어로 박아 둔 화면 문구는
  우리 사전의 기존 키를 쓴다. 시안이 새로 만든 문구(셸·상태 화면·완료 편집기 등 약 230키)는 **ko/en/es 3개를 사전에 추가.**
- **PPR.** 루트 레이아웃에서 쿠키를 읽지 않는다. 셸은 `(app)/layout.tsx` 와 `crews/[slug]/layout.tsx` 에 둔다.
  `loading.tsx` 22개·`error.tsx`·`global-error.tsx` 파일은 그대로 두고 내용만 시안 컴포넌트로.
- **네이티브 브리지.** 시안 `useNative()` 는 `window.RoxNative` 를 읽는다 — 우리 `lib/native.ts` 의 `roxNative()` 와
  같은 브리지다. 시안 훅을 우리 헬퍼 위에 얹는다.
- **기록지 합성**(`lib/record-card.ts`)·OG·One Tap 정책·프로그램 미리보기 조건 — 앞서 확정한 대로.

## 2. 셸·네비게이션 (시안 `rox-app.tsx` 그대로)

```
SidebarProvider(--sidebar-width 15.5rem)
├ a.rx-skip                         "본문으로 건너뛰기"
├ Sidebar.rx-sidebar
│  ├ SidebarHeader   .rx-brand      → 링 마크 + ROXLOGY (1-b)
│  ├ SidebarContent  3 그룹 14 항목  나의 퍼포먼스(대시보드·세션 기록·레이스 결과·목표 & 계산기·분석 리포트)
│  │                                트레이닝(주간 일정·훈련 프로그램·러닝 기록·운동 라이브러리·PFT 측정)
│  │                                커뮤니티(대회 일정·크루·리더보드·피드)
│  └ SidebarFooter   .rx-crew-link  내 크루(마크 · 이름 · 도시) → 실제 첫 소속 크루, 없으면 "크루 찾기"
│                    .rx-profile    아바타 · 표시 이름 · "프로필 & 설정"
├ SidebarInset.rx-shell
│  ├ header.rx-topbar  [SidebarTrigger · MY WORKSPACE]   [LocaleSwitch · 검색 · 알림(미확인 점) · 아바타]
│  ├ div#main-content.rx-main   (max 1600 · 32/36)
│  └ footer.rx-footer  "ROXLOGY · THE SCIENCE OF HYBRID RACING"  ·  우측 보조 문구
├ MobileNavigation.rx-mobile-tabs  세션 | 트레이닝▾ | (Watch, 네이티브만) | 레이스▾ | 크루 | 피드
│  └ RoxDialog kind="sheet" .rx-more-grid   트레이닝: 프로그램·러닝·일정·운동  /  레이스: 레이스·PFT·대회·예측·목표·리더보드
└ Toaster richColors
```

- **셸 없이 렌더**: `/`, `/login`, `/signup`, `/auth/native`, `/board/*`. 이들은 `.rx-public` + `PublicHeader`
  (브랜드 · LocaleSwitch · 로그인 · 회원가입 CTA) 또는 라이브보드 전용 `.rx-live-topbar`.
- **크루 라우트**는 `(app)` 밖(공유 링크·비로그인 열람)이므로 `crews/[slug]/layout.tsx` 에서 로그인 여부로 분기:
  로그인 = 앱 셸, 비로그인 = `PublicHeader`. 우리 `crew-header.tsx`·`crew-tabs.tsx` 는 시안 `.rx-crew-header` + `NavTabs` 로 대체.
- 시안의 `.rx-preview-tag`(디자인 커버리지 링크)는 넣지 않는다.
- 삭제 대상: `app-sidebar.tsx` · `global-nav.tsx` · `mobile-tabbar.tsx` · `nav-icon.tsx` · `settings-nav.tsx` · `crew-tabs.tsx`.
  `lib/nav.ts` 는 시안 `groups` 상수로 정리(`NAV_GROUPS` 항목 순서·아이콘을 시안과 일치).
- 반응형은 시안 미디어쿼리 그대로: 1250 / 1200 / 1100 / 1050 / 1000 / 767 / 700 / 600 / 390, min 1700.
  767 미만에서 사이드바는 `Sheet` 로, 하단 탭이 나타난다.

## 3. 화면 매핑 — 시안 뷰 → 우리 라우트

구조 표기: `PageHead(액션)` `Stats(n)` `two-col[좌 | 우]` `form-layout[본문 | 보조]` `Panel "제목"`.
"우리 추가"는 우리 화면에는 있으나 시안에 대응 구조가 없는 기능이다 — **§4 규칙**을 따른다.

### 3-a. 공개·인증·상태

| 시안 | 우리 라우트 | 구조 | 우리 추가 |
|---|---|---|---|
| `Landing` | `/` | `.rx-public` · `PublicHeader` · `.rx-landing-hero`(kicker·h1·p·actions·small + `.rx-landing-result` 결과 카드·`.rx-landing-splits`) · `.rx-landing-demo`(문구 + `.rx-demo-chart` 8막대) · `.rx-landing-features` 3장 · `.rx-public-footer` | 크루 티커(`.rx-crew-ticker` 클래스가 시안에 있음 → 실데이터로 채움). 히어로 결과 카드는 시안 데모 숫자 그대로 |
| `AuthScreen` | `/login` `/signup` | `.rx-auth-layout` > `.rx-auth-card`(Google `.rx-google` · `.rx-auth-divider` · 이메일 폼 · 비밀번호 표시 · 로그인 유지 · 동의 · `.rx-auth-notice` · `.rx-auth-link`) | One Tap(정책 유지). 시안의 "Google 안내 다이얼로그"는 실제 OAuth 로 대체 |
| `NativeAuth` | `/auth/native` | `.rx-state-page` + `.rx-native-steps` 4상태 | 상태 선택기 제외 |
| `NotFoundScreen` · `ErrorScreen` | `not-found.tsx` · `error.tsx` · `global-error.tsx` | `.rx-state-page` (아이콘 · 제목 · 문구 · actions) | — |
| `GateScreen` ×5 | (app) 정지 · 크루 로그인 · 모임 멤버 전용 · 회계 정회원 · 프로필 필수 | `.rx-state-page` + 아이콘 + 주 행동 1개 + `.rx-state-note` | `AccessGate` 삭제 |
| `WatchScreen` | **신규** `/watch` | `PageHead` + `Panel.rx-watch-panel` | 네이티브 탭에서 열림 (§7 결정 1) |

### 3-b. 나의 퍼포먼스

| 시안 | 우리 라우트 | 구조 | 우리 추가 |
|---|---|---|---|
| `Dashboard` | `/dashboard` | `PageHead(세션 기록)` · `.rx-stats` 4(전체 세션·최고 기록·다음 레이스 D-·오늘의 훈련) · `.rx-dashboard-grid`[`Panel.rx-race-feature`(다크: eyebrow·tag·h2·`.rx-race-time`·`.rx-race-split`·`.rx-split-labels`·`.rx-feature-link`) \| `Panel "오늘의 훈련"`(`.rx-today-date` + `.rx-workout-row`×n)] · `.rx-dashboard-grid`[`Panel "최근 기록"`(`RecordRow`) \| `Panel "다음 목표"`(`.rx-target`)] | 현재 628줄에 든 나머지 위젯(백분위·크루 소식·프로그램 진행 등) |
| `Records` | `/sessions` `/races` | `PageHead(비교·새 기록)` · `Stats` · `Panel "기록 목록"`(`.rx-toolbar`: Find·Choice·Segments) · `DataTable`[날짜/기록·디비전·출처·완주 시간·""] · `Empty` | 공유 토글·삭제 |
| `RecordDetail` | `/sessions/[id]` `/races/[id]` | `Back` · `PageHead(기록 카드·편집)` · `.rx-detail-hero`(chip·제목·시간·메타) · `Stats` · `two-col`[`Panel "런 페이스 흐름"`(`.rx-lap-chart`) \| `Panel "구간별 기록"` DataTable] · `Panel "기록에서 읽을 수 있는 것"`(`.rx-insight`) · `Panel "기록 상세"` DataTable | 938줄의 리플레이 표·비교 링크·AI 인사이트·파트너 박스·레이스→세션·공유 토글·백분위 곡선 |
| `Compare` | `/sessions/compare` | `Back` · `PageHead` · `Panel "기록 비교"`(`.rx-compare-bars` + DataTable[날짜·대회·디비전·기록·이전 대비]) · `Empty` | 세션 선택 UI |
| `RecordForm` | `/sessions/new` `/sessions/[id]/edit` `/races/new` `/races/[id]/edit` | `Back` · `PageHead(Segments 대회/시뮬)` · `form.rx-form-layout`[`Panel "HYROX 공식 기록 검색"` · `Panel "01 · 기본 정보"`(`.rx-form-grid`) · `Panel "02 · 구간 기록"`(DataTable 입력) \| `Panel "기록 요약"`(`.rx-summary-time`) + 저장] | race-new-form 830줄의 파트너·디비전 상세·시간 입력기 |
| `RecordCardScreen` | **결정 2** | `PageHead` · `.rx-share-layout`[`.rx-card-preview` \| `.rx-form-grid` 비율·테마·사진·맞춤·확대·위치·이름/날짜 표시 · 다운로드] | 현재는 상세 안 모달(`record-card-button.tsx`) |
| `Goals` · `predict` | `/goals` `/predict` | `PageHead(계산기)` · `.rx-card-grid`(`.rx-goal-card`) / `Back` · `PageHead` · `form-layout`[`Panel "목표 설정"`(grid·actions·DataTable 구간/목표/비중) \| `Panel "목표 요약"`(chip·summary-time·DataTable)] | predict-form 772줄의 디비전별 분포·백분위 |
| `Insights` | `/insights` | `PageHead` · `Panel "이번 기록의 분석 상태"`(DataTable 검토 항목/상태 + Go) | — |

### 3-c. 트레이닝

| 시안 | 우리 라우트 | 구조 | 우리 추가 |
|---|---|---|---|
| `Schedule` | `/schedule` | `PageHead(프로그램)` · `two-col`[`Panel "주간 훈련"`(actions · `.rx-week` 7일 · `.rx-schedule-row` / `Empty "휴식일"`) \| `Panel "이번 주 진행"`(summary-time·ProgressBar) · `Panel "내 레이스 일정"`(RecordRow)] | 여러 프로그램 동시 진행 표시 |
| `RacePlan` | `/schedule/race/[id]` | `Back` · `PageHead(편집·초대)` · `.rx-plan-hero` · `two-col`[목표 구간 배분 · 파트너 DataTable · 메모 \| 대회 일정 · 크루] · `.rx-plan-check` · RoxDialog 2 | — |
| `Programs` | `/programs` | `PageHead(새 프로그램)` · `Segments` · `.rx-card-grid`(`.rx-program-card` + `.rx-program-top.tone-n`) | program-finder 검색 |
| `ProgramDetail` | `/programs/[id]` | `Back` · `PageHead(actions)` · `two-col`[`Panel "훈련 계획"`(요일 Segments · 운동 행 / Empty) \| `Panel "프로그램 정보"` DataTable + Go] | **program-builder 1,232줄**(소유자 편집) · 등록·복제·캘린더 구독·AI 생성 |
| `ProgramNew` | `/programs/new` | `Back` · `PageHead` · `form-layout`[`Panel "기본 설정"` \| `Panel "계획 미리보기"`] | AI 프로그램 버튼 |
| `Workout` | `/workouts/[id]` | `Back` · `PageHead(세션으로 기록)` · `form-layout`[`Panel "오늘의 운동"`(chip·ProgressBar·`.rx-workout-check`) \| `Panel "훈련 메모"`] | workout-sets 세트별 입력 |
| `Exercises` | `/exercises` `/exercises/[id]` | `PageHead` · `.rx-toolbar`(Find·Choice) · `Segments` · `.rx-list-count` · `.rx-card-grid`(`.rx-exercise-card`) / `Back` · `PageHead` · `two-col`[운동 정보(`.rx-exercise-feature`) \| 나의 운동 메모(`.rx-note-row`)] | exercise-drills · 운동 요청 |
| `Runs` | `/runs` `/runs/new` `/runs/[id]/edit` | `PageHead(새 기록)` · `Panel "러닝 타임라인"` DataTable[날짜·코스·거리·시간·페이스·편집] / `form-layout`[`Panel "러닝 정보"` \| `Panel "평균 페이스"`] / `EditRecord(run)`: 변경 요약 DataTable + 미저장 RoxDialog | — |
| `PFT` 허브 | `/pft` | `PageHead(기록 추가·측정 시작)` · `two-col`[`Panel.rx-pft-feature` \| `Panel "나의 기록"`(RecordRow+chip)] · `Panel "크루 PFT 레이스"`(코드로 참가·만들기 · 레이스 행 actions) · Go 리더보드 | 레이스 목록 pft-race-list |
| `PFT` 측정·추가·편집·리더보드 | `/pft/measure` `/pft/new` `/pft/[id]/edit` `/pft/leaderboard` | `form-layout`[`.rx-stopwatch`+actions \| `Panel "구간 기록"`] / `form-layout`[측정 결과 grid \| 입력 확인] / `EditRecord(pft)` / `Panel "완주 결과"` DataTable[순위·선수·성별·시간·상태] | pft-measure-view 415줄의 자동 랩 |
| `PFT` 참가·생성 | `/pft/race/join` `/pft/race/new` | `Back` · `PageHead` · `Panel "참가 코드" / "레이스 정보"` + Go | 운영진 전용 조건 |
| `PftRaceOverview` | `/pft/race/[code]` | `Back` · `PageHead` · `two-col`[레이스 현황(chips·actions) \| 나의 참가 상태(summary-time·chip)] | pft-race-runner 487줄 선수 화면 |
| `PftStaff` | `/pft/race/[code]/staff` | `.rx-pft-staff` > `Back` · `PageHead(라이브보드·선수 화면·`.rx-pft-close`)` · `.rx-pft-statusline` · `.rx-pft-local` · `.rx-pft-staff-top`[선수 추가(검색·결과) \| 웨이브 출발(picks·select-actions·waiting-list·assign)] · `.rx-pft-athletes` 카드 · `.rx-pft-footnote` | pft-race-staff 827줄의 실시간 구독·취소·재타이밍 |
| `PftLiveBoard` | `/board/[code]` | `.rx-live-board`(다크) > `.rx-live-topbar`(브랜드·상태) · `.rx-live-main`[`.rx-live-racehead`(제목·stages·stats) · `.rx-live-grid`[entrants(웨이브·아바타) · timing(목록·stage-now) · finish(순위)]] · `.rx-live-footer` | pft-board-topbar 의 전체화면·소리 |

### 3-d. 커뮤니티·크루

| 시안 | 우리 라우트 | 구조 | 우리 추가 |
|---|---|---|---|
| `Events` | `/events` `/events/[id]` | `PageHead` · `.rx-toolbar` · `two-col`(`.rx-event-card`) · `Empty` / `Back` · `.rx-event-hero`(chip) · `two-col`[레이스 준비 DataTable + actions \| 같이 출전하는 크루 + Go] | 내 계획 연결 |
| `Crews` | `/crews` `/crews/new` | `PageHead(새 크루)` · `.rx-toolbar` · `.rx-crew-discover` 행(아트 280px · 정보 · chip) · `Empty` / `Panel "크루 기본 정보"` grid | 비로그인 `/crews` 는 `PublicHeader` 로 |
| `Crew` 소개 | `/crews/[slug]` | `.rx-crew-header`(mark·h1+chip·meta·Go 관리) · `NavTabs` 7 · `two-col`[소개(`.rx-info-grid`·chips) \| 다가오는 모임(`.rx-meeting-row`+Go)] · `two-col`[크루 공지(RecordRow) \| 나의 회비(chip·summary-time·Go)] | 가입 버튼·커버 이미지 |
| `CrewSchedule` | `/crews/[slug]/schedule` `/schedule/[eventId]` | `Segments` · `.rx-meeting-row`(`.rx-calendar-date`·chip) / `Back` · `PageHead` · `two-col`[모임 소개(chip·DataTable) \| 내 참석 여부(Segments)] · `Panel "댓글 n"` | **crew-schedule-forms 2,043줄**(생성·수정·반복·참석 관리) |
| `CrewBoard` | `/board` `/board/new` `/board/[postId]` `/board/[postId]/edit` | Go 글쓰기 · `.rx-toolbar` Segments · `.rx-board-row` / `Back` · `PageHead "크루 글쓰기"` 폼 / `Back` · chip·제목·메타·Go 편집 · `.rx-prose` · `Panel "댓글"` / `EditRecord(post)` | 좋아요·게시글 액션 |
| `MemberList` | `/crews/[slug]/members` · `/members` | chip 인원 · `.rx-toolbar`(Find·Choice) · `DataTable`[멤버·회원 구분·공유 세션] · `Empty` | — |
| `Leaderboard` | `/leaderboard` `/crews/[slug]/leaderboard` | `PageHead` · `Panel "총 완주 시간"`(Choice) · `DataTable`[순위·선수·디비전·최고 기록] · `Empty` | — |
| `Finance` | `/crews/[slug]/finance` | `.rx-finance` > `Stats` · `.rx-finance-tabs`(Segments 장부/회비/기준) · `.rx-finance-layout`[본문: 거래 장부(toolbar·DataTable·`.rx-finance-entry`·`.rx-finance-ledger-total`) / 이번 달 회비 현황(`.rx-finance-dues-kpis`·ProgressBar) + 회비 대상자 / 등급별 회비 기준 \| `aside.rx-finance-aside`: 거래 추가(`.rx-finance-field-pair`) · 지출 구성(`.rx-finance-mix-bar`) · 크루 계좌(`.rx-finance-bank`) · 회비 기준] | 정산·월 마감·회비 링크/알림·미납 카드·계좌 개설·내보내기 (7개 컴포넌트 약 2,800줄) |
| `Manage` | `/crews/[slug]/manage` | chip 운영진 · `Segments` · `Panel "크루 훈련 프로그램"` · 등급별 회비 DataTable / 기본 정보 grid + `.rx-switch-row` | crew-manage 1,471줄(회원 등급·상태·초대·변경 이력) · tier-manage |
| `Feed` | `/feed` | `PageHead(멤버)` · `Segments` · `.rx-feed-layout`[`.rx-feed-record`(chip·actions·Go) \| `Panel "이번 주 크루"`] | — |
| `Profile` | `/u/[id]` | `PageHead` · `.rx-person` · 팔로우 · 기록 RecordRow | 백분위 바 |

### 3-e. 계정·관리

| 시안 | 우리 라우트 | 구조 | 우리 추가 |
|---|---|---|---|
| `SearchPage` | `/search` | `PageHead` · `Find` · `Segments` · `RecordRow`(chip) · `Empty` | — |
| `Notifications` | `/notifications` | `PageHead(모두 읽음)` · `Segments` · `.rx-notification(.read)` | — |
| `Settings` | `/settings/profile` | `PageHead(관리자)` · `Segments`[공개 프로필 · 로그인과 기기 · HYROX 공식 기록 · 내 AI 연결 · 알림] · 탭별 Panel(`.rx-profile-editor`·`.rx-switch-row`·RecordRow 앱 다운로드·`.rx-info-grid` MCP) | 연결 계정·시간대 동기화·로그아웃 |
| `Admin` | `/admin` `/users` `/content` `/crews` `/races` `/moderation` | `PageHead(chip)` · `NavTabs` 5 · 홈: `Stats`+`two-col`[운영 바로가기 \| 확인할 데이터] / 사용자 목록 DataTable / 운동 콘텐츠 DataTable / 등록 크루 RecordRow / PFT 레이스 RecordRow / 기록 검토 DataTable | 운동 편집기·요청·프로그램/세션 액션·크루 상태 |
| `UserDetail` | `/admin/users/[id]` | `Back` · `PageHead` · `form-layout`[계정(아이콘·chip·DataTable·Go) · 활동 · 크루 DataTable · 편집(grid·actions) \| 변경 이력 · 접근 권한] · RoxDialog 변경 확인 | — |
| `Download` | `/download` | `PageHead` · `Panel "앱 다운로드"` | — |

## 4. 시안에 없는 것 — 추정하지 않는다

원래 지시("지침에 없는 사항은 추정으로 만들지 말고 캡쳐해서 보여줘")를 그대로 적용한다.

1. **시안에 대응 화면이 있고 우리 기능이 더 많은 경우** — 시안 구조 안에 넣되, 넣을 자리가 없는 기능은
   시안 프리미티브(Panel·Field·Button·Chip·RoxDialog…)로만 감싸고 **캡쳐해 "시안에 없음" 목록에 올린다.**
   대상 대부분이 큰 상호작용 컴포넌트다: 프로그램 빌더, 크루 일정 폼, 회계 정산·마감, 크루 관리, PFT 스태프
   실시간, 레이스 입력 폼, 예측 폼, 기록 상세의 리플레이·AI.
2. **시안에만 있고 우리에 없는 것** — `/watch`(결정 1), `/records/share`(결정 2), `/design-coverage`(넣지 않음).
3. **시안 데모 데이터**(HYROX SHENZHEN·LOOP8·Kimchoho 등)는 전부 실데이터로 교체. 랜딩 히어로의 예시 결과 카드만
   시안 숫자를 그대로 둔다(비로그인 화면이라 실데이터가 없다).

## 5. 단계

각 단계 끝에 커밋 → `tsc`·`eslint`·`next build` → 하네스로 해당 라우트 1200/390 캡쳐 → 시안 렌더와 나란히 보고.

| # | 범위 | 만드는 것 / 지우는 것 | 검증 |
|---|---|---|---|
| **P0 기준 렌더** | 시안 자체를 띄워 68 라우트 캡쳐 | `source/` 에서 `pnpm install` → `pnpm dev` → 하네스로 1200/390 캡쳐 → 스크래치패드 보관(커밋 안 함) | 기준 이미지 확보. 이후 모든 단계의 비교 대상 |
| **P1 기반** | 의존성 · 프리미티브 15종 · `globals.css` 교체(브랜드 예외 5곳) · `ui.tsx` · `RoxDialog` · `lucide-react` | `components/ui/{button,…,sidebar}.tsx` · `components/rox/ui.tsx` · `lib/utils.ts(cn)` · `hooks/use-mobile.ts`. 삭제: `app-ui.tsx` `app-filters.tsx` | 빌드 통과. 기존 화면은 깨져 보이는 것이 정상(과도기) |
| **P2 셸·네비** | §2 전부 | `components/rox/app-shell.tsx` · `mobile-navigation.tsx` · `public-header.tsx`. `(app)/layout.tsx`·`crews/[slug]/layout.tsx` 교체. 삭제 6파일 | 사이드바 푸터 크루·프로필 실데이터, 알림 점, 767 미만 Sheet+하단 탭, 바텀시트, skip link |
| **P3 상태·공개** | 3-a | `public-screens.tsx` 이식(Landing·Auth·Native·404·Error·Gate) · `loading-states.tsx` 22종 → `skeleton.tsx` 교체 | 6 라우트 + 22 loading + 5 게이트 캡쳐 |
| **P4 퍼포먼스** | 3-b | dashboard · records ×2 · detail ×2 · compare · form ×4 · goals/predict · insights · share | 13 라우트 |
| **P5 트레이닝** | 3-c 앞부분 | schedule · race plan · programs ×3 · workout · exercises ×2 · runs ×3 | 12 라우트 |
| **P6 PFT** | 3-c 뒷부분 | 허브 · measure · new · edit · leaderboard · join/new · overview · staff · 라이브보드 | 10 라우트, 라이브보드는 다크 대비 재검사 |
| **P7 크루·회계** | 3-d | crews ×2 · 소개 · 일정 ×2 · 게시판 ×4 · 멤버 · 리더보드 ×2 · 회계 · 관리 · 이벤트 ×2 · 피드 · 프로필 | 19 라우트. 비로그인 `/crews`·`/crews/[slug]` 는 `PublicHeader` |
| **P8 계정·관리** | 3-e | search · notifications · settings · admin ×6 · user detail · download | 10 라우트 |
| **P9 정리** | 잔여 | `.theme-dark` 스코프 제거(시안 CSS 가 자체 색을 가짐) · 안 쓰는 토큰·컴포넌트 삭제 · `docs/design/README.md` 갱신 · "시안에 없음" 캡쳐 묶음 | 68 라우트 × 2폭 전수 캡쳐, 오버플로 0, JS 오류 0, 대비 스크립트 |

규모(실측): 우리 `web/` TS/TSX 52,676줄 중 화면·컴포넌트 약 2/3 가 JSX 교체 대상. 300줄 넘는 컴포넌트 25개.
P4–P8 은 각각 독립적이라 순서를 바꿔도 되고, 단계마다 프리뷰로 확인받을 수 있다.

## 6. 검증

- **시안 대 우리** 나란히 비교: P0 기준 이미지 vs 각 단계 캡쳐(1200·390). 구조·간격·타이포가 같은지 눈으로 확인하고 차이는 목록화.
- 하네스 자동 검사: 390px 가로 스크롤 0, 콘솔 오류 0, `report.json`.
- 대비: 시안 `:root` 조합 + 브랜드 예외 5곳을 `check-contrast.mjs` 로 재계산. 옐로가 밝은 면 텍스트로 쓰인 곳 0.
- 모바일 폭 320/360/375/390/430/600/767/768 — 시안 `MobileReview` 와 같은 폭.
- 다이얼로그 회귀(포커스·Tab·Escape·inert·스크롤 잠금·중첩) — 우리 Dialog 가 그대로라 기존 동작 유지 확인만.
- 성능 규칙: 사이드바 푸터의 크루 조회는 레이아웃의 기존 `Promise.all` 에 합쳐 왕복을 늘리지 않는다. 목록 행은 `RowLink`.
- DB·마이그레이션 변경 없음. 작업은 `web/` 안에서만.

## 7. 승인 시 함께 답해 주실 결정

| # | 항목 | 추천 |
|---|---|---|
| 1 | `/watch` 화면 — 시안에는 있고 우리에는 없다(네이티브 탭이 브리지를 바로 연다) | **시안대로 라우트 추가.** 네이티브면 브리지 호출, 웹이면 안내 |
| 2 | 기록 카드 — 시안은 독립 화면(`/records/share`), 우리는 상세 안 모달 | **`/sessions/[id]/share`·`/races/[id]/share` 라우트로 이식.** 상세의 "기록 카드" 액션이 이동. 합성 로직은 동일 파일이라 그대로 |
| 3 | 시안에 자리가 없는 우리 기능(§4-1) 의 처리 | **시안 프리미티브로만 감싸고 캡쳐 보고.** 새 레이아웃을 지어내지 않는다 |
| 4 | 랜딩 히어로 결과 카드 숫자 | **시안 데모 숫자 유지**(비로그인, 실데이터 없음). 크루 티커만 실데이터 |
| 5 | 사이드바 푸터 "내 크루" 가 여러 개일 때 | **가장 오래 가입한 크루 1개**, 나머지는 크루 목록에서 |
| 6 | `/design-coverage` 갤러리 | **가져오지 않음**(디자인 검수용) |

## 8. 이 계획으로도 검증되지 않는 것

앞서 정리한 후속 검수 항목 그대로다 — One Tap 두 경로, 실기기(iOS Safari·Android Chrome), 스크린 리더,
운영 데이터 길이에서의 넘침, 라이브보드 TV 원거리 가독성, 기존 화면의 en/es 문구. 완료로 처리하지 않는다.
