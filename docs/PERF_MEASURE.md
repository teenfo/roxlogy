# Roxlogy 웹 성능 — 측정 작업 지시서

> 대상: 2026-09-13 에 적용한 성능 변경의 효과 측정.
> 이 문서 하나만 읽고 처음부터 끝까지 할 수 있게 썼다. 앞선 대화 맥락은 필요 없다.
> 작성 2026-09-13.

## 0. 이 작업의 성격 — **측정만 한다**

**코드를 고치지 말 것.** 이 작업은 숫자를 재서 보고하는 것이 전부다.
개선안이 떠오르더라도 적용하지 말고 §6 보고서에 적기만 한다.

이미 내려진 결정이라 다시 제안하지 않아도 된다:

- 공개 페이지 CDN 캐싱은 **보류**다(쿠키 기반 i18n 때문에 앱 전체 리팩터가 전제 —
  배경은 `docs/PERF.md` 참조). 이 측정 결과로 그 결정을 다시 볼 것이다
- Supabase 레거시 HS256 서명키는 **그대로 둔다**
- 함수 리전 `hnd1`, 정적 자산 캐시 헤더, 압축 설정은 건드리지 않는다

## 1. 대상 정보

| 항목 | 값 |
| --- | --- |
| 프로덕션 | `https://roxlogy.com` |
| 레포 | `teenfo/roxlogy` (Next.js 앱은 `web/`) |
| Vercel 프로젝트 | `roxlogy` (`prj_mudCKKXdavhKkqqhgpRHKaGlZfhf`) |
| Vercel 팀 | `flexmania-1761's projects` (`team_6ngum30VcR6jV5Ae7ovdvxd6`) |
| 측정 대상 커밋 | `f5b8e8e` ~ `2cd556b` (2026-09-13 배포분) |

측정 전에 **Vercel 프로덕션 배포가 READY 인지** 먼저 확인한다. BUILDING 중이면
옛 번들을 재게 된다.

## 2. 기준선 — 이 숫자와 비교한다

개선 전(2026-09-13, 서울 회선 / Vercel `icn1` 엣지):

| 항목 | 개선 전 |
| --- | --- |
| `/dashboard` RSC 프리페치 | **29건**, 927ms 에 시작해 2674ms 까지 이어짐 |
| `/robots.txt`·`/sitemap.xml` (엣지 HIT) | 20~37ms |
| 존재하지 않는 경로 (404, 함수 경유) | 298~377ms |
| `/crews` (RSC) | 269~380ms |
| `/events` | 409~974ms |
| `/dashboard` HTML | 473~648ms |
| Vercel Speed Insights | 미설치 (이벤트 0건) |

적용된 변경은 네 가지다: Speed Insights 설치, `/events`·`/download` 를 미들웨어에서
제외, 목록 행 링크 `prefetch={false}`, DB 인덱스·RLS 정리.

**캐싱은 손대지 않았으므로 응답 시간은 거의 그대로일 것이 정상이다.**
기대 효과가 있는 항목은 프리페치 건수 하나다.

---

## 작업 1 (최우선) — 보호 경로 회귀 확인

미들웨어 matcher 를 건드렸으니 **로그인 보호가 깨지지 않았는지부터** 본다.
다른 측정보다 먼저 하고, 어긋나면 즉시 보고한다.

```bash
curl -sSI https://roxlogy.com/dashboard | grep -iE '^HTTP/|^location'
```

기대:

```
HTTP/2 307
location: /login?next=%2Fdashboard
```

같은 방식으로 몇 개 더 확인한다 — 전부 307 + `/login?next=…` 이어야 한다:

```bash
for p in /dashboard /sessions /settings/profile /programs /notifications /admin /u/1; do
  printf '%-18s ' "$p"
  curl -sSI "https://roxlogy.com$p" | grep -iE '^HTTP/|^location' | tr '\n' ' '
  echo
done
```

미들웨어에서 뺀 두 경로는 로그인 없이 **200** 이어야 한다:

```bash
curl -sSI https://roxlogy.com/events   | head -1
curl -sSI https://roxlogy.com/download | head -1
```

> **307이 아닌 것이 하나라도 나오면 거기서 멈추고 바로 보고할 것.** 보안 회귀다.
> 되돌릴 커밋은 `e8fb015` 하나다(`web/proxy.ts` 의 matcher).

---

## 작업 2 — 응답 시간과 캐시 헤더

```bash
for p in /robots.txt /sitemap.xml /events /crews /dashboard /this-path-does-not-exist; do
  printf '%-26s ' "$p"
  curl -s -o /dev/null \
    -w 'total %{time_total}s  ttfb %{time_starttransfer}s  code %{http_code}\n' \
    "https://roxlogy.com$p"
done
```

캐시 헤더는 **연속 두 번** 호출해서 2회차를 본다:

```bash
for p in /events /crews /predict; do
  echo "=== $p"
  for i in 1 2; do
    curl -sSI "https://roxlogy.com$p" | grep -iE 'x-vercel-cache|^cache-control|^age'
    echo "  --- ($i회차)"
  done
done
```

### 이 결과를 어떻게 읽는가

- `x-vercel-cache: MISS` 와 `cache-control: private, no-cache, no-store` 가 **그대로 나오는 것이
  정상이다.** 캐싱 작업을 하지 않았기 때문이다. 이것을 "실패"로 보고하지 말 것
- 여기서 확인하려는 것은 **응답 시간이 기준선에서 나빠지지 않았는가** 하나다
- 각 경로를 3회씩 재고 중앙값을 적는다 (한 번만 재면 콜드 스타트에 휘둘린다)

---

## 작업 3 (핵심 지표) — `/dashboard` RSC 프리페치 건수

**29건 → 10건 이하**가 목표다. 이 숫자 하나로 대형 리팩터가 필요한지 판단한다.

### ⚠️ 이 작업은 로그인된 브라우저가 필요하다

`/dashboard` 는 보호 경로다. **계정 자격증명을 이 문서나 스크립트에 넣지 말 것.**
자동화된 로그인을 시도하지 말고, 아래 둘 중 하나로 처리한다:

- **이미 로그인된 브라우저 세션이 있으면** 그걸로 진행한다
- **없으면 이 작업을 건너뛰고**, §6 보고서에 "로그인 세션이 없어 미수행" 이라고 적은 뒤
  사람이 직접 할 수 있도록 아래 절차를 그대로 전달한다

### 절차 (데스크톱 크롬)

1. `roxlogy.com` 에 로그인한 상태에서 `F12` 로 개발자도구를 연다
2. Network 탭 → **Disable cache 체크**
3. 주소창에 `roxlogy.com/dashboard` 를 입력해 **새로 로드**한다
   (새로고침 말고 주소창 입력 — 개선 전 측정과 조건을 맞춘다)
4. 로드 후 **3초 기다린다. 스크롤하지 않는다** —
   링크가 화면에 들어오면 프리페치가 추가로 발생해 비교가 틀어진다
5. Console 탭에 붙여넣는다:

```js
const r = performance.getEntriesByType('resource').filter(e => e.name.includes('_rsc='));
console.log('프리페치 건수:', r.length);
if (r.length) {
  console.log('마지막 요청 종료:', Math.round(Math.max(...r.map(e => e.responseEnd))), 'ms');
  console.table(r.map(e => ({
    경로: new URL(e.name).pathname,
    시작: Math.round(e.startTime),
    소요ms: Math.round(e.duration),
  })));
}
```

### 보고할 것

- **건수** (개선 전 29건)
- **마지막 요청 종료 시각** (개선 전 2674ms)
- **표에 남아 있는 경로 목록** — 어떤 링크가 아직 프리페치되는지가 다음 작업의 단서다

---

## 작업 4 — Vercel Speed Insights

Speed Insights 는 2026-09-13 에 막 설치돼서 아직 데이터가 얇다.

1. **지금**: [Vercel → roxlogy → Speed Insights](https://vercel.com/flexmania-1761s-projects/roxlogy/speed-insights)
   에서 **"No events collected" 가 사라졌는지**만 확인한다. 사라졌으면 설치 성공이다
   (안 사라졌으면 사이트를 몇 페이지 돌아다닌 뒤 5분쯤 기다려 다시 본다)
2. **2~3일 뒤**: 같은 화면에서 **TTFB** 와 **LCP** 의 **p75** 를 적는다.
   Real Experience Score 가 있으면 그것도 적는다

이 작업은 Vercel 대시보드 접근이 필요하다. 권한이 없으면 §6 에 그렇게 적는다.

---

## 5. 하지 말 것

- **코드를 고치지 말 것.** 이 작업은 측정이다
- **자격증명을 문서·스크립트·로그에 남기지 말 것.** 로그인 자동화를 시도하지 말 것
- `x-vercel-cache: MISS` 를 문제로 보고하지 말 것 — 캐싱을 하지 않았으니 정상이다
- 함수 리전(`hnd1`)·정적 자산 캐시 헤더·압축 설정을 건드리지 말 것
- Supabase JWT 서명키를 건드리지 말 것 — 이미 비대칭(ES256)이고 성능과 무관하다
- 프리페치를 측정할 때 스크롤하지 말 것 (숫자가 부풀어 비교가 틀어진다)
- 한 번만 재고 결론 내지 말 것 — 응답 시간은 3회 중앙값으로 적는다

## 6. 보고 양식

아래를 그대로 채워서 보고한다. **모르거나 못 한 항목은 비우지 말고
"미수행 — 이유" 라고 적을 것.**

```
■ 배포 상태
  측정 시각:
  프로덕션 배포 커밋 / 상태:

■ 작업 1 — 보호 경로 (가장 중요)
  /dashboard        →           (기대: 307 + /login?next=%2Fdashboard)
  /sessions         →
  /settings/profile →
  /programs         →
  /notifications    →
  /admin            →
  /u/1              →
  /events           →           (기대: 200)
  /download         →           (기대: 200)
  판정: 이상 없음 / 회귀 있음(내용:          )

■ 작업 2 — 응답 시간 (3회 중앙값)
  경로                     total     ttfb      code
  /robots.txt
  /sitemap.xml
  /events
  /crews
  /dashboard
  (없는 경로, 404)
  캐시 헤더 2회차: /events =            /crews =            /predict =

■ 작업 3 — 프리페치  (개선 전: 29건 / 2674ms)
  건수:
  마지막 요청 종료:        ms
  남아 있는 경로:

■ 작업 4 — Speed Insights
  "No events collected" 사라졌는가:
  TTFB p75:            LCP p75:            (2~3일 뒤)

■ 그 밖에 눈에 띈 것 (고치지 말고 적기만)
```
