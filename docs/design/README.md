# 디자인 리뉴얼 지침 (스펙 1.3 · 게시 v5)

외부 디자인 산출물 원본과, 우리 쪽에서 확정한 적용 규칙을 함께 둔다.
**디자인 작업 전에 이 파일과 `brand/roxlogy-brand-guide.html` 을 먼저 읽는다.**

| 파일 | 내용 |
|---|---|
| `ROXLOGY-Global-Design-Spec.md` | 색·타입·레이아웃·컴포넌트 계약·화면 매핑 (§01–§21) |
| `ROXLOGY-Mobile-Design-Guide.md` | 모바일 밀도·탐색·입력·검수 (§01–§16) |
| `ROXLOGY-Design-Audit.md` | 원본 화면 분석과 A.01–A.15 보완 기록 |
| `design-tokens.json` | 현행 토큰 추출 + 권장 모바일 값 |

출처: 스펙 1.3 / 게시 버전 5 / 2026-09-16 / 시안 소스 커밋 `ed3aed0b`.
시안은 **디자인 프로토타입**이다 — 실인증·권한·기록 동기화·결제가 연결돼 있지 않다.
**디자인 규칙만 가져오고 데이터·권한·라우팅·상태 계약은 우리 것을 유지한다.**

## 대전제 — 브랜드 자산은 그대로, 디자인 스펙은 지시대로

충돌하면 **브랜드가 이긴다.**

| 그대로 쓰는 것 (`brand/` v4) | 지시를 따르는 것 (스펙 1.3) |
|---|---|
| 마크 4종 원본(`roxlogy-mark` · `-inverse` · `-appicon` · `-watchface`) — 손으로 다시 그리지 않음 | 배경·패널·보더·입력·상태 칩·안내 영역·수입/지출·차트 팔레트·PFT 스테이지 6색 |
| 구성 규칙: 옐로 링 **항상 8조각**, 블루 링 **절대 안 끊음**, 블루는 옐로 안쪽, 20px 이하는 링 없이 R 단독 | 사이드바 248 / 상단바 74 / 본문 1600·32·36 및 반응형 분기 전부 |
| 워드마크 `ROXLOGY` 대문자 · Archivo Black | 타이포 크기·굵기·자간 스케일, 본문 16/1.6 |
| 브랜드 4색: Race Yellow `#FFD500` · Black `#141414` · Track Blue `#2D7DFF` · Chalk `#F4F4F2` | §05 의 12개 컴포넌트 계약, 버튼·입력·표 치수 |

### 스펙의 노란색 계열은 전부 브랜드 옐로로 되돌린다

| 스펙 값 | 대체 | 근거 |
|---|---|---|
| `--primary #EFCF20` / `.rx-primary #EFD126` | **`#FFD500`** (글자 `#252B31` 유지) | 대비 **10.06:1** — 스펙 자신의 9.41:1 보다 낫다 |
| `.rx-brand` 노란 사각 + 이탤릭 `R.` (`#F3D321`) | **`brand/roxlogy-mark.svg`** 링 마크 + 워드마크 | 브랜드 자산 우선 |
| `.rx-crew-mark` 글자 `#EFCF20` | `#FFD500` | 〃 |
| 사이드바 활성 인디케이터 `inset 3px 0 #DFC026` | `#FFD500` | 〃 |
| 스펙에 없는 Track Blue | `#2D7DFF` 를 **런·페이스 의미 색으로 유지** | 브랜드 4색 중 하나 |

스펙을 따르는 것: `--sidebar-accent #FFF7CC`(활성 메뉴 면), `--chart-1 #CFB714`(범주 색),
PFT 스테이지 6색 — 브랜드 색이 아니라 **UI 표면·범주 색**이다.

### 밝은 면에서 옐로는 텍스트로 쓰지 않는다

`#FFD500` 대비: 흰 카드 **1.42:1**, 배경 `#F5F6F8` **1.31:1**, 차콜 `#222930` **10.34:1**.
→ 버튼 배경·강조 면·차콜 패널 위에만. 밝은 면의 강조 텍스트는 **딤 골드**로 간다
(`web/lib/record-card.ts` 가 이미 쓰는 `#8a7a2a` 선례).
Track Blue 도 흰 배경 **3.83:1** 이라 **비텍스트(선·아이콘)까지만**.

## 다크로 남는 곳

밝은 앱으로 가되 아래 넷은 다크를 유지한다. 라이트 전환 대상이 아니다.

1. **PFT 라이브보드** `/board/[code]` — 현장 모니터용 독립 화면 (`#12171C` / `#181F26`)
2. **대시보드·상세의 레이스 강조 패널** — `#222930` / `#252D34`
3. **기록지(공유 카드)** — SNS 에 올라가는 이미지라 화면 테마와 무관
4. **OG 이미지** — 차콜 `#222930` 계열

## 확정 결정 (2026-09-16)

1. **프로그램 미리보기(`?preview=1`) = 로그인한 비소유자 시점.**
   편집·삭제·캘린더 토큰 재발급 숨김, 복제 버튼 표시, 소유자 전용은 상단 "편집으로" 링크만.
   "내 일정"·ICS 다운로드·구독 링크 복사는 **보는 사람의 등록 상태**에 따라 유지.
2. **OG = 공통 정적 1종 + 크루·모임 동적 2종.** 프로그램·세션·레이스 결과 전용 OG 는 만들지 않는다.
   동적 카드는 **비로그인 방문자에게 공개된 정보만** 쓴다 → 쿠키를 읽지 않는 anon 클라이언트로만
   조회한다(`lib/supabase/server.ts` 는 항상 쿠키를 읽으므로 OG 에서 쓰지 않는다).
   `next/og`(satori)는 **woff2 를 못 읽는다** — `public/fonts/pretendard/` 의 92조각은 전부 woff2 라
   쓸 수 없고, OG 전용 Pretendard **TTF Bold 1종**을 `web/assets/og/` 에 버전 고정해 둔다.
3. **One Tap 은 동작 정책만.** 비로그인 크루 페이지와 로그인·가입 페이지에서만 호출,
   `cancel_on_tap_outside: false` 유지, 재노출은 Google SDK·브라우저 정책에 위임, 반복 호출·닫힘
   제한 우회 금지, 미노출·실패 시 일반 로그인 버튼으로 계속 이용 가능.
   `use_fedcm_for_prompt: true` 라 카드는 **브라우저가 그린다** — 위치·색을 우리가 정할 수 없다.

## 스펙보다 우리 것을 유지하는 항목

- **라우팅**: 시안의 "일반 HTML 문서 이동"(§10)을 따르지 않는다. App Router + PPR 이고
  `CLAUDE.md` 성능 규칙이 `RowLink`·`loading.tsx`·`Promise.all` 을 요구한다.
- **Dialog**: `components/ui/dialog.tsx` 를 시그니처째 보존한다(스펙 §20 도 동일하게 명시).
  shadcn Dialog/Sheet 를 도입하지 않는다.
- **모바일 하단 탭**: 넣지 않는다(2026-09-20 결정). 시안·스펙 §15 는 768px 미만에서 하단 5탭을 두지만,
  우리 셸은 같은 폭에서 사이드바가 드로어로 바뀌어 메뉴가 두 번 보이고 하단 탭이 드로어와 겹쳤다.
  드로어(상단바 트리거) 하나만 남긴다. 네이티브 Watch 탭이 열던 `/watch` 는 라우트만 남아 있다(아래 "화면 점검").
- **폰트**: Pretendard 자체 호스팅(92조각 서브셋) 유지. 시안은 폰트 파일을 포함하지 않는다.
- **상태**: Supabase 서버가 source of truth. 시안의 localStorage/sessionStorage 프로토타입 계약은
  가져오지 않는다.

## 다국어 범위

**신규 화면과 공통 탐색만 ko/en/es** 를 채운다. 기존 도메인 화면의 문구는 이번 범위에서
재번역하지 않는다(스펙 §20 도 "기존 사이트 전체의 문장별 en/es 전환은 완료로 주장하지 않습니다").

## 검증되지 않은 항목 (완료로 처리하지 않는다)

1. One Tap 구식 iframe 폴백 경로 — 캡쳐·검수 미실시
2. One Tap FedCM 경로 — 브라우저가 그리는 UI라 코드로 확인 불가
3. 실기기 검수 — iOS Safari / Android Chrome 의 키보드·safe-area·회전·200% 확대
4. 스크린 리더 — VoiceOver / TalkBack
5. 운영 데이터에서의 렌더 — 캡쳐는 픽스처 기반이라 실제 길이의 이름·제목 넘침은 미확인
6. PFT 라이브보드의 TV 원거리 가독성 — 실제 모니터 필요

---

## 이식 결과 (2026-09-20 · 브랜치 `claude/design-renewal` · PORT_PLAN P0–P9)

시안 소스(`roxlogy-renewal/source`)의 화면 코드를 라우트별로 옮기고 데이터만 우리 것으로 갈아 끼웠다.
셸·계약·프리미티브·스타일은 시안 것이고, 브랜드 자산(마크·워드마크·`#FFD500`)만 위 규칙대로 되돌렸다.

| 단계 | 커밋 | 범위 |
|---|---|---|
| P0 | (스크래치패드) | 시안 자체를 띄워 68 라우트 × 1200/390 기준 캡쳐 |
| P1 | `71e6e97` | 프리미티브 16종 · `globals.css` 통째 교체 · `components/rox/ui.tsx` 계약 · `RoxDialog` |
| P2 | `ccb5263` | 사이드바·상단바·푸터·모바일 탭+시트 · 사이드바 고정 크루(`profiles.sidebar_crew_id`) |
| P3 | `f652a08` | 랜딩·로그인·네이티브 인증·404·오류·권한 게이트·스켈레톤 22종 |
| P4 | `4845208` | 대시보드·세션·레이스·입력·비교·목표·리포트·기록 카드 (13 라우트) |
| P5 | `0264a01` | 일정·레이스 계획·프로그램·운동·라이브러리·러닝 (12 라우트) |
| P6 | `84f2c49` | PFT 허브·측정·기록 폼·리더보드·레이스·스태프·라이브보드 (10 라우트) |
| P7 | `27e0f21` | 크루 소개·일정·게시판·멤버·리더보드·회계·관리 · 대회 · 피드 · 공개 프로필 (19 라우트) |
| P8 | `ae779c3` | 설정·검색·알림·다운로드·관리자 6 (11 라우트) |
| P9 | 이 커밋 | 죽은 모듈 삭제 · 대비 스크립트 · 전수 캡쳐 · 이 보고 |

### 검증 (실제로 돌린 것만 적는다)

- `tsc --noEmit` 0 오류 · `eslint app components lib` 0 오류(경고 2 — `lib/session-builder.ts` 기존)
- 픽스처 하네스 전수 캡쳐: **81 라우트 × 1200/390 = 162장**, 브라우저 `pageerror` **0**
  - 200: 70 라우트. 404: 11 라우트 — 전부 의도한 것(`/404` 자체, `/design-coverage/*` 7종은 시안 인덱스라 넣지 않음,
    `/records/share` 는 확정 2 로 만들지 않음, `/pft/demo-pft` 는 픽스처에 없는 id)
  - 가로 넘침: `/sessions/[id]` 1건 → 통계 타일의 긴 값이 밀던 것을 `.rx-stat > strong { overflow-wrap:anywhere }` 로 잡고 재캡쳐 — `/sessions/[id]`·`/dashboard`·`/crews/loop8/finance` × 2폭 6장 넘침 0
- 단계마다 해당 라우트를 1200/390 으로 캡쳐해 모바일을 육안으로 봤다(P4~P8 커밋 메시지에 건수)
- `node scripts/check-contrast.mjs` — 시안 `:root` 토큰과 칩·힌트·수입/지출 색 33쌍 (아래 "대비")

### 시안에 없어 Panel 등으로만 감싼 것 (PORT_PLAN §4 — 추정으로 만들지 않았다)

시안에 대응 자리가 없는 우리 기능. 시안 프리미티브(Panel·Field·Button·Chip·DataTable·RoxDialog·RowMenu)만 써서 넣었고,
각 파일 주석에 `시안에 없` 으로 표시해 두었다(`grep -rn "시안에 없" web/app web/components`). 캡쳐는 스크래치패드 `captures/p9/`.

- **퍼포먼스**: 대시보드 위젯 7종(크루 일정·스테이션 최고·추이·훈련 vs 레이스·리허설·AI·백분위), 세션 상세 분석
  (구성비·분포 곡선·스플릿 바·저하율·에르그 곡선·스트로크·AI), 레이스 상세(시뮬 대비표·리플레이표·세션 만들기·AI),
  세션 입력의 RPE·워크아웃 연결·리더보드 제외, 비교의 세션 고르기, 목표의 삭제·배분, 공식 기록 연동 안내, 예측 폼 내부
- **트레이닝**: 프로그램 빌더·미리보기(확정 1), AI 생성 버튼, 검색·레벨 필터·내/커뮤니티 구분, 러닝 1km 기준선·90일 요약,
  운동 영상·내 추이, 레이스 계획 폼·파트너 초대
- **PFT**: MY BEST 게이지·전체 기록 표·규격, 측정의 예상 완주·구간 PB·완주 배지, 라이브보드의 배지·중도포기·페이지·참가 코드
  (종료 뒤 배지별 3열 정리 화면은 뺐다)
- **크루**: 커버 이미지·가입 버튼·승인 대기 배지·관리 탭 대기 수, 모임 등록·참석 토글(목록)·출석 체크 카드·설정 토글·
  대회일정 목록(인라인 수정은 상세로 통일), 납부 링크 관리·회비 계좌·회원 이력 다이얼로그·장부 행 메뉴·묶음·확인할 일·
  등급 분포·통계 타일, 대회의 지난 대회·디비전 실측 통계
- **계정·관리**: 로그인 수단 연동/해제, 사이드바 고정 크루, 언어, MCP 토큰 발급·재발급·폐기·변경 허용, 푸시 켜기·테스트·
  WOD 시각, 알림 삭제·읽음 필터·날짜 묶음, 관리자 사용자 상세/편집·운동 편집·등록 요청·공개 프로그램·크루 승인·모더레이션

### 대비 — 시안 값 그대로라 미달인 조합 (결정 필요)

`check-contrast.mjs` 33쌍 중 **12쌍이 스펙 §11(4.5:1 / 비텍스트 3:1) 미달**이고 전부 **시안이 정한 값**이다.
"시안을 그대로" 라는 지시에 따라 값을 고치지 않았다. 고칠지 결정해 주면 한 줄씩 바꾼다.

| 조합 | 비율 | 시안 값 | 4.5:1 을 넘기는 최소 변경 예 |
|---|---|---|---|
| `.rx-hint` · `.rx-muted` / 카드 | 3.20 | `#87919d` | `#6f7a87` (4.6) |
| `.rx-income` / 카드 | 4.47 | `#448369` | `#3f7a61` (4.9) |
| `.rx-expense` / 카드 | 3.99 | `#b56b66` | `#a85f5a` (4.6) |
| 기본 칩 · 옐로 칩 · `tier-yellow` | 4.47 | `#82701f` on `#fcf5d5` | `#7a6a1e` (4.9) |
| 그린 칩 | 4.27 | `#397e5e` on `#e7f3ed` | `#377a5b` (4.5) |
| 블루 칩 | 3.63 | `#627daf` on `#eaf0ff` | `#526da1` (4.6) |
| `tier-gray` | 4.37 | `#69727f` on `#f0f3f6` | `#616974` (4.9) |
| 차트 1·2 / 카드 (비텍스트 3:1) | 2.01 · 2.89 | `#cfb714` · `#8297cf` | 범례 글자와 함께 쓰므로 색만으로 구분하지 않는다 — 유지 가능 |

허용 예외 4(경계선·입력 경계·옐로 면·아이브로)는 스크립트에 사유를 적어 두었다.

### 잔여 — 아직 Tailwind 확장 토큰을 쓰는 클라이언트 컴포넌트 (32)

페이지는 전부 시안 마크업이지만, 아래 컴포넌트는 내부가 여전히 `text-muted`·`bg-surface`·`text-gold` 같은 Tailwind
유틸을 쓴다. 그래서 `globals.css` 끝의 **"확장 토큰" 블록은 지우지 못했다**(지우면 이 컴포넌트들의 색이 빠진다).
새 화면에는 쓰지 말고 `.rx-*` 를 쓴다. 다시 그릴 순서 제안: 예측 폼 → 프로그램 빌더 → 레이스 입력 폼 → 리플레이 표 → 나머지.

`predict-form` · `program-builder` · `race-new-form` · `race-replay-table` · `program-enroll-button` · `rehearsal-report` ·
`charts` · `workout-checklist` · `race-edit-form` · `exercise-drills` · `program-new-form` · `record-card-button` ·
`percentile-bar` · `distribution-curve` · `workout-sets` · `program-basics-editor` · `ai-insight` · `chart-frame` ·
`delete-button` · `program-calendar-subscribe` · `goal-delete-button` · `ai-program-button` · `clone-program-button` ·
`export-button` · `google-one-tap` · `info-tip` · `locale-switcher` · `race-to-session-button` · `run-form` · `share-toggle`
(`app/(app)/leaderboard/page.tsx` · `app/(app)/members/page.tsx` 는 2026-09-20 화면 점검에서 시안 마크업으로 다시 그렸다)

삭제한 옛 모듈: `components/ui/app-ui.tsx` · `app-filters.tsx` · `crew-ui.tsx` · `settings-ui.tsx` · `nav-icon.tsx` ·
`settings-nav.tsx` · `search-box.tsx`. 남은 것은 `components/rox/*`(셸·계약·다이얼로그·필터·사람 행·관리자 머리)와
`components/ui/*` 프리미티브뿐이다.

### 이 이식으로도 검증되지 않은 것 (완료로 처리하지 않는다)

위 "검증되지 않은 항목" 1~6 에 더해:

7. **운영 데이터 렌더** — 캡쳐는 픽스처다. 픽스처가 만든 `crew.cat.dues_monthly` 같은 사전 미등록 값·`join_policy 1` 같은
   비정상 값이 화면에 그대로 보였는데, 실데이터에서는 나오지 않는 값이다. 실제 크루명·거래명·긴 한글 제목의 넘침은 배포 후 확인
8. **상호작용** — 캡쳐는 첫 화면이다. 다이얼로그(모임 등록·장부 수정·회원 이력·기초 잔액·PFT 확인)·행 메뉴·탭 전환·폼 제출은
   코드 검토와 타입 검사만 했고 브라우저에서 눌러 보지 않았다
9. **실제 계정 권한 분기** — 픽스처는 한 계정(관리자·크루 리더)이다. 비회원·일반회원·정회원·부리더 시점의 화면은 조건 분기를
   그대로 옮겼을 뿐 각 시점으로 렌더하지 않았다
10. **en/es 문구** — 신규 키만 3언어로 넣었다. 기존 도메인 문구의 영어·스페인어 재번역은 범위 밖

### 화면 점검 (2026-09-20 · 소스 레벨 + 화면 레벨)

**소스 레벨** — `app/**/page.tsx` 71개 라우트를 전부 열어 시안 프리미티브(`components/rox/*`)로 그리는지 봤다.

| 결과 | 라우트 |
|---|---|
| 시안 마크업 (직접 import) | 59 |
| 시안 마크업 (폼·보드 컴포넌트에 위임 — `auth-form`·`pft-race-board`·`pft-measure`·`program-new-form`·`race-new-form`·`session-new-form`·`session-edit-form` 이 rox 를 import) | 10 — `/login` `/signup` `/board/[code]` `/programs/new` `/pft/measure` `/pft/race/[code]` `/pft/race/[code]/staff` `/sessions/new` `/sessions/[id]/edit` `/races/new` |
| **미반영이었던 것 → 이번에 이식** | 2 — `/leaderboard` (PageHead · Segments 종합+스테이션 8 · Panel(action Choice 디비전) · DataTable 순위/선수/디비전/최고 기록), `/members` (PageHead · Panel[Find · `.rx-switch-row` 사람 행 + 팔로우/프로필 보기 · Hint]) |

**화면 레벨** — P9 전수 캡쳐(81 라우트)에서 빠졌던 3개 라우트를 이번에 처음 찍었다: `/pft/race`(내 레이스 목록),
`/races/[id]/share`, `/sessions/[id]/share`(기록 카드). 위 2개 이식 라우트는 픽스처에 `leaderboard_overall`·
`leaderboard_station`·`discover_members` 모양을 더해 **행이 있는 상태**로 다시 찍었다. 14 라우트 × 1200/390 = 28장 +
재캡쳐 6장, `pageerror` 0, 가로 넘침 0. 캡쳐: 스크래치패드 `captures/audit/`·`captures/audit2/`.

**모바일 하단 탭 제거** — 768px 미만에서 시안의 `MobileNavigation`(하단 5탭 + 바텀시트)이 사이드바 드로어와 함께 떠서
같은 메뉴가 두 번 보이고 서로 겹쳤다. `components/rox/mobile-navigation.tsx` 를 지우고 `app-shell.tsx`·`globals.css`
(`.rx-mobile-tabs`·`.rx-native-tabs`·`.rx-shell` 하단 여백)·`lib/nav.ts`(하단 탭 전용 `NAV`·`PUBLIC_NAV`·`activeNavKey`)에서
걷어냈다. 390px 캡쳐 14장 모두 하단 탭 없음, 상단바 트리거 → 드로어만 남는다.

남는 것 하나: **`/watch`** 는 네이티브 앱의 하단 Watch 탭이 열던 화면이라 이제 앱 안에서 들어가는 메뉴가 없다(주소로만
열린다). 라우트와 화면은 그대로 두었다 — 사이드바에 넣을지, 설정 > 연동으로 옮길지, 라우트를 지울지는 결정 사항.

### 다시 돌리는 법

```bash
cd web
A=next; B=ser; pgrep -f "$A-${B}ver" | xargs -r kill
ROX_FIXTURES=1 NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture npx next build
ROX_FIXTURES=1 NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture npx next start -p 3111 &
node scripts/capture-screens.mjs --routes <routes.json> --out <dir>   # [["/path","in"],…] · 1200/390 · report.json
node scripts/check-contrast.mjs                                        # 미달이 있으면 exit 1
```
