# 디자인 공백 후속 구현 — 2026-09-20

이번 변경 범위는 프로그램 멤버 미리보기, 외부 공유 OG 3종, Google One Tap 정책이다.
기준 커밋: `0e413cdfb46e774c1ec8df9629e1d6f45b600a41`.
사용자 요청에 따라 `feat/design-gaps-preview-og-onetap` 브랜치에서 작업한다.

## 1. 프로그램 미리보기

`/programs/[id]?preview=1`은 **로그인한 비소유자 시점**이다.
프로그램의 실제 소유권이나 서버/RLS 권한을 바꾸는 모드는 아니다.

| 요소 | 소유자 편집 | 소유자 미리보기 | 비소유자 |
| --- | --- | --- | --- |
| 기본 정보 편집·삭제·빌더 | 표시 | 숨김 | 숨김 |
| 캘린더 토큰 재발급 | 등록 시 표시 | 숨김 | 숨김 |
| 복제 | 숨김 | 표시 | 표시 |
| 상단 ‘편집으로’ | 숨김 | 표시 | 숨김 |
| 시작·중단, 내 일정·ICS·구독 복사 | 본인의 등록 상태 | 본인의 등록 상태 | 본인의 등록 상태 |

기존 `readOnly`를 컨트롤 전체에 일관되게 적용한다. 미리보기에서 소유자 본인의
활성 등록을 가리지 않으며 등록/복제 작업은 실제 계정에 반영된다.

## 2. 공유 이미지

| 종류 | 소스 | 표시 정보 |
| --- | --- | --- |
| 공통 정적 | `web/app/opengraph-image.png` | 원본 마크, ROXLOGY, 영어 태그라인 |
| 공개 크루 | `web/app/crews/[slug]/opengraph-image.tsx` | 크루명, 태그라인, 지역, 회원 수 |
| 공개 모임 | `web/app/crews/[slug]/schedule/[eventId]/opengraph-image.tsx` | 크루명, 모임명, 날짜·시간, 참석 수/정원 |

프로그램·세션·레이스 전용 OG는 추가하지 않는다. 기록 공유는 기존 브라우저 canvas
기록지가 담당한다. 공개 크루의 하위 경로는 Next.js 메타데이터 상속에 따라 크루
이미지를 쓰고, 모임 상세는 전용 이미지를 쓴다.

### 시각 규칙

- 1200 × 630 PNG, 배경 `#222930`, 본문 `#F4F4F2`, 보조 `#ACB8C1`, 강조 `#FFD500`.
- 좌우 안전 여백 64px, 상하 52px. 제목 55px, 보조 23–26px, 숫자 48px.
- 원본 `web/public/roxlogy-mark.svg`를 임베드한다. 8조각 옐로 링/연속 블루 링을 유지한다.
- 워드마크 Archivo Black, 공유물 한글 IBM Plex Sans KR Bold. 앱의 Pretendard CSS는 유지한다.
- 제목은 최대 36 Unicode 코드포인트, 부제 46, 상세 40으로 줄이고 말줄임표를 붙인다.
  완전한 제목/설명은 페이지 메타데이터와 본문에서 읽는다.
- 공유물은 쿠키/기기 언어에 따라 변하지 않는다. 사용자 작성 ko/en/es 제목은 유지하고,
  정보 라벨은 영어, 모임 시각은 `Asia/Seoul`로 변환한 뒤 **KST를 명시**한다.

### 공개 데이터 경계

`web/lib/og/public-data.ts`는 쿠키를 읽지 않는 별도 익명 Supabase 클라이언트를 쓴다.
기존 `crew_overview`와 `crew_event_detail` RPC의 공개 조회 조건을 따른다.
서비스 역할 키, 요청자의 액세스 토큰, 개인화된 서버 클라이언트를 쓰지 않는다.

- 크루는 익명 RPC 결과 + active 상태를 확인한다.
- 모임은 공개 크루, UUID와 slug 일치, `members_only === false`, 유효한 일시를 확인한다.
- 비공개·정회원 전용·취소·없는 항목·slug 불일치·조회 오류는 모두 동일한 브랜드 PNG로
  돌아간다. 모임 이름·존재 사유를 카드에 노출하지 않는다.
- OG뿐 아니라 크루/모임의 제목·설명 메타데이터도 같은 익명 조회를 사용한다.
- 참석자 이름은 기존 공개 RPC의 배열 길이를 계산하는 데만 사용한다. 카드 데이터에
  명단·댓글·회원 등급·계좌·개인 토큰을 넣지 않는다.
- RPC 요청에는 3초 타임아웃과 `cache: no-store`, 동적 이미지 응답에는 `Cache-Control:
  no-store`를 적용한다. `React.cache`는 렌더 내 중복 제거만 한다. 서버의 오래된 캐시가
  공개→비공개 변경을 무시하지 않게 한다. 이미 외부 플랫폼이 수집한 이미지는 해당
  플랫폼의 캐시 정책에 따르며, 이 헤더로 원격 사본을 회수할 수는 없다.
- `metadataBase`는 기존 단일 출처 `https://roxlogy.com`을 쓴다. 프리뷰 검증 시에는
  메타태그의 이미지 경로를 프리뷰 호스트에서도 직접 열어 확인한다.

### 폰트와 재생성

폰트와 라이선스는 `web/assets/og/`에 포함한다. 서버용 TTF 두 개를 Node 런타임에서
프로세스당 한 번 읽어 재사용한다. 외부 CDN 호출과 요청마다 통짜 한글 폰트를
다운로드하는 비용이 없고, 일반 페이지에 OG용 폰트를 전송하지 않는다.
웹 UI용 Pretendard 동적 서브셋 파일은 변경하지 않는다.

```sh
cd web
npm ci
npm run og:generate
# 선택: 검토용 크루/모임/긴 제목 샘플 생성
npm run og:generate -- /tmp/roxlogy-og-samples
```

브랜드 카드는 생성 결과 PNG를 커밋하므로 요청 시 렌더 비용이 없다. 두 동적 라우트의
배포 추적 파일에 폰트·원본 마크·브랜드 PNG가 포함되는 것도 확인했다.

## 3. Google One Tap

노출 위치는 기존의 **비로그인 크루 페이지와 로그인/가입 페이지**로 유지한다.
`use_fedcm_for_prompt: true`, `cancel_on_tap_outside: false`를 유지한다.
FedCM의 프롬프트 UI는 브라우저가 관리하므로 자체 카드로 다시 그리지 않는다.

각 마운트에서 초기화/프롬프트 요청은 한 번만 한다. 닫기 또는 미표시 뒤의 타이머 재시도,
강제 재노출, cooldown 초기화를 추가하지 않는다. 다음 방문의 허용 여부도 SDK/브라우저가
결정한다. 미지원 브라우저의 레거시 경로 또한 Google SDK에 맡긴다.

클라이언트 ID가 없으면 컴포넌트를 렌더하지 않는다. SDK 로드, nonce 준비, 인증 교환의
전송 실패를 처리하고 ko/en/es 안내를 표시한다. 기존 이메일·Google 버튼 로그인은
계속 사용할 수 있다. 기존 nonce 원문/해시 계약과 내부 경로 리디렉트 검증도 유지한다.

## 4. 검증 결과와 후속 확인

2026-09-20 로컬 검증:

| 검사 | 결과 |
| --- | --- |
| 회귀 테스트 | 22개 통과 — 소유권×preview×등록 8조합, 공개/비공개 데이터 경계, One Tap 중복·실패·nonce |
| TypeScript | `npm run typecheck` 통과 |
| ESLint | 오류 0, 기존 `lib/session-builder.ts` 미사용 변수 경고 2개 |
| 프로덕션 빌드 | Next 16.2.10 / Cache Components, 더미 DB 환경으로 통과 |
| 이미지 렌더 | 브랜드·한글 크루·모임·긴 한글 제목/스페인어 부제 PNG 생성 및 시각 확인 |
| HTTP 응답 | 로컬 RPC fixture로 크루/모임 PNG 200·1200×630·no-store 확인 |
| 공개 경계 HTTP | 비공개 크루/모임·다른 slug에서 브랜드 PNG와 바이트 동일 확인 |
| 메타태그 | 루트/크루/모임의 OG·Twitter 이미지 경로, 제목, 크기 확인 |

테스트 명령은 `cd web && npm run test:design-gaps`이며 기존 GitHub `web-ci`에도 추가했다.
HTTP 검증은 실제 Next 프로덕션 서버와 로컬 RPC fixture를 이용했다. 운영 DB의 RLS나
실제 Google 세션을 사용한 검증으로 간주하지 않는다.

다음은 **미확인 후속 QA**이며 설계 미결정 항목은 아니다:

- 승인된 원본과 Google 로그인 세션에서 FedCM 로그인·닫기·다음 방문 확인.
- 레거시 One Tap이 실제 표시되는 데스크톱/모바일에서 겹침 확인 및 캡처.
- 배포 후 실제 공개/비공개 크루·정회원 전용 모임의 익명 링크 검사.
- 카카오톡 등 실제 공유 클라이언트의 캐시 재수집 및 잘림 확인.

참고: [Next ImageResponse](https://nextjs.org/docs/app/api-reference/functions/image-response),
[이미지 메타데이터 규약](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image),
[Google FedCM 마이그레이션/쿨다운](https://developers.google.com/identity/gsi/web/guides/fedcm-migration).
