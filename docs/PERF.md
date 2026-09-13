# 웹 성능 — 현재 상태와 구조적 제약

> 2026-09-13 성능 작업의 결과 기록. 다음에 같은 조사를 반복하지 않기 위해 남긴다.
> 원인 분석은 §1이 핵심이다.

## 0. 기준선 (서울, Vercel `icn1` 엣지)

| 요청 | 소요 시간 | 엣지 처리 |
| --- | --- | --- |
| `/robots.txt`·`/sitemap.xml` (`○` 정적) | **20~37ms** | `icn1` **HIT** |
| 존재하지 않는 경로 (404, 함수 경유) | **298~377ms** | `icn1::hnd1` MISS |
| `/crews` (RSC) | 269~380ms | MISS |
| `/events` | 409~974ms | MISS |
| `/dashboard` HTML | 473~648ms | MISS |

엣지에서 끝나는 요청과 함수를 거치는 요청의 차이가 **약 270ms**. 서울↔도쿄 왕복이
35~45ms 이므로 **나머지 약 225ms 가 Next.js 함수 실행 자체**다(내용이 없는 404 기준).

**이 225ms 를 없애는 방법은 함수를 부르지 않는 것뿐이다.** 그런데 §1 때문에 막혀 있다.

## 1. 왜 모든 라우트가 동적(`ƒ`)인가 — 구조적이다

빌드 출력에서 80여 개 라우트가 전부 `ƒ` 이고 정적인 것은
`/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` 셋뿐이다.

**원인은 파일 하나가 아니다. 쿠키 기반 i18n 이다.**

- `lib/i18n/index.ts:40` 의 `getT()` 가 `await cookies()` 로 `NEXT_LOCALE` 을 읽는다
- **`app/**/page.tsx` 68개 중 66개가 `getT()` 를 직접 호출**한다 (55개는 추가로
  Supabase 서버 클라이언트도 만든다 — 이것도 `cookies()` 를 쓴다)
- `app/not-found.tsx` 도 `getT()` 를 부른다. 그래서 404조차 동적이다
- `app/layout.tsx` 의 `getT()` 는 그중 하나일 뿐이다

### 실험으로 확인한 것

루트 레이아웃의 `getT()` 호출만 제거하고 빌드하면 **정적으로 바뀌는 라우트가 0개**다.
각 페이지가 독립적으로 쿠키를 읽기 때문에 레이아웃만 고쳐서는 아무 일도 일어나지 않는다.

```
before static: /manifest.webmanifest, /robots.txt, /sitemap.xml
after  static: /manifest.webmanifest, /robots.txt, /sitemap.xml   ← 변화 없음
```

### 그래서 정적화·CDN 캐싱은 i18n 구조를 바꾸지 않으면 불가능하다

`<html lang={locale}>` 이 쿠키에 달려 있어서 `<Suspense>` 로도 못 미룬다.
선택지는 둘뿐이고 **둘 다 URL 또는 렌더 방식이 바뀌는 큰 결정**이다:

1. **로케일 경로 분리** (`/ko/...`, `/en/...`) — Next 의 정석. URL 이 전부 바뀐다.
   sitemap·robots·공유 링크·안드로이드 WebView 시작 URL 이 모두 영향을 받는다
2. **기본 로케일로 정적 렌더 + 클라이언트 전환** — SEO 와 최초 렌더 언어가 틀어진다

어느 쪽도 "성능 작업" 범위에서 혼자 결정할 일이 아니다. 착수 전 합의가 필요하다.

## 2. 적용된 것 (2026-09-13)

| 커밋 | 내용 |
| --- | --- |
| `f5b8e8e` | Vercel Speed Insights 설치 — 실사용자 지표 수집 시작 |
| `e8fb015` | `/events`(목록)·`/download` 를 미들웨어 matcher 에서 제외 |
| `855e300` | 목록 화면 행 링크에 `prefetch={false}` |
| `c3f3c1d` | 마이그레이션 098 — 중복 인덱스 제거, RLS `(select auth.uid())` 래핑 |

## 3. 하지 않은 것과 이유

- **공개 페이지 `revalidate` 캐싱** — §1 때문에 불가능하다. 라우트가 동적인 한
  `export const revalidate` 는 효과가 없다
- **미들웨어 matcher 대폭 축소** — `/`, `/crews`, `/predict`, `/board/*` 는 뺄 수 없다.
  미들웨어가 만료된 액세스 토큰을 갱신해 응답 쿠키에 실어 주는데, 서버 컴포넌트는
  쿠키를 쓸 수 없어서 빼면 토큰이 만료된 로그인 사용자가 비로그인으로 보인다.
  세션을 아예 읽지 않는 `/events`·`/download` 만 뺐다
- **PPR / `cacheComponents`** — §4 참조. 켤 수는 있지만 앱 전체 리팩터가 전제다
- **FK 인덱스 누락·미사용 인덱스** — 실제 쿼리 패턴이 보인 뒤에 판단한다

## 4. PPR(`cacheComponents`)을 실제로 켜 본 결과

Next 16 에서 `experimental.ppr` 은 **`cacheComponents` 로 통합**됐다
(`experimental: { ppr: 'incremental' }` 는 빌드 에러 — 플래그가 없어진 게 아니라 이름이 바뀐 것).

`cacheComponents: true` 로 빌드해 보면 두 단계에서 막힌다:

1. `app/board/[code]/page.tsx` 의 `export const dynamic = "force-dynamic"` 과 호환되지 않는다
   (`Route segment config "dynamic" is not compatible`)
2. 그걸 빼면 다음은 프리렌더에서 터진다 —
   `Route "/admin/content": Uncached data was accessed outside of <Suspense>`

**핵심: `cacheComponents` 는 라우트별 옵트인이 아니라 전역이다.** 예전 `ppr: 'incremental'`
이 담당하던 "적용할 라우트에만 켜기"가 사라져서, 켜는 순간 **68개 페이지 전부가**
캐시되지 않는 데이터 접근을 `<Suspense>` 로 감싸야 한다. 한두 라우트만 시험 삼아
적용하는 길이 없다.

즉 캐싱으로 가는 길은 어느 쪽을 골라도 앱 전체를 건드리는 작업이다.

## 5. 이미 확인했고 원인이 아닌 것 — Supabase JWT 서명키

`proxy.ts` 의 `getClaims()` 가 요청마다 Auth 서버로 왕복하는 것 아니냐는 의심이 있었으나
**2026-09-13 확인 결과 아니다. 다시 조사하지 말 것.**

JWKS(`alg: ES256`, `kty: EC`, P-256) · 실제 발급 토큰 헤더 · 대시보드 JWT Keys 3중 확인으로
**비대칭 서명 전환이 이미 끝나 있다.** `getClaims()` 는 JWKS 로컬 검증 경로를 타고 요청당
Auth 왕복은 없다. §0 의 225ms 는 대부분 Next.js 함수 실행 자체다.

레거시 HS256 키가 `Previously used keys` 에 남아 있지만 성능과는 무관하다(위생 차원의
정리 항목이고, 인증에 손대는 변경이라 사람 승인이 필요하다).

## 6. 결정 (2026-09-13)

- **캐싱(작업 3)은 보류.** 로케일 경로 분리도, `cacheComponents` 전면 도입도 지금은
  하지 않는다. 먼저 `prefetch={false}` 효과와 Speed Insights 실사용자 데이터를 보고
  재판단한다 — 대시보드 프리페치가 29건에서 목표(10건 이하)로 줄었다면 체감이 크게
  달라지고, 그러면 대형 리팩터가 필요 없을 수 있다.
  **재판단 재료**: `/dashboard` 에서 `performance.getEntriesByType('resource')
  .filter(e => e.name.includes('_rsc=')).length`, 그리고 Vercel → Speed Insights 의 TTFB/LCP.
- **레거시 HS256 키는 그대로 둔다.** 성능과 무관하고, 지금 인증을 건드릴 이유가 없다.

## 7. 건드리지 말 것

- 함수 리전 `hnd1`(도쿄) — Supabase 가 `ap-northeast-1` 이라 서울로 옮기면 DB 왕복마다
  지연이 더 붙는다. 정본은 `web/vercel.json`
- 정적 자산 캐시 헤더 (`public, max-age=31536000, immutable`) — 이미 엣지 HIT 확인됨
- 압축 설정 — Brotli 정상 (130KB → 37KB)
- 성능을 이유로 Pro 플랜 전환 — 원인이 컴퓨트가 아니다
- **Supabase JWT 서명키를 성능 목적으로 건드리지 말 것** — §5 에 확인 근거가 있다
