# 웹 성능 — 현재 상태와 구조적 제약

> 2026-09-13 성능 작업의 결과 기록. 다음에 같은 조사를 반복하지 않기 위해 남긴다.
> 원인 분석은 §1이 핵심이다.

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
- **PPR** — Next 16 에서 `experimental.ppr` 은 `cacheComponents` 로 통합됐다.
  기능은 살아 있지만, §1 을 해결하기 전에는 정적 셸이 만들어지지 않아 의미가 없다
- **FK 인덱스 누락·미사용 인덱스** — 실제 쿼리 패턴이 보인 뒤에 판단한다

## 4. 확인이 필요한 것

**Supabase JWT 서명키가 비대칭인지** (대시보드 → Settings → JWT Keys).

`proxy.ts` 의 `supabase.auth.getClaims()` 는 비대칭 키면 JWT 를 로컬 검증하지만(네트워크 0회),
레거시 HS256 공유 시크릿이면 요청마다 Auth 서버로 왕복한다. 미들웨어는 보호 라우트의
**모든** 요청(RSC 프리페치 포함)에서 돌기 때문에, 레거시라면 이것이 동적 요청 바닥값의
큰 부분일 수 있다. 비대칭으로 전환하면 코드 변경 없이 그만큼이 사라진다.

## 5. 건드리지 말 것

- 함수 리전 `hnd1`(도쿄) — Supabase 가 `ap-northeast-1` 이라 서울로 옮기면 DB 왕복마다
  지연이 더 붙는다. 정본은 `web/vercel.json`
- 정적 자산 캐시 헤더 (`public, max-age=31536000, immutable`) — 이미 엣지 HIT 확인됨
- 압축 설정 — Brotli 정상 (130KB → 37KB)
- 성능을 이유로 Pro 플랜 전환 — 원인이 컴퓨트가 아니다
