# Vercel 설정 작업 지시서

> 대상: Roxlogy 웹(Next.js)의 Vercel 프로젝트 설정 정리.
> 이 문서 하나만 읽고 처음부터 끝까지 할 수 있게 썼다. 앞선 대화 맥락은 필요 없다.
> 작성 2026-09-13.

## 0. 이 작업의 성격

**코드 변경은 원칙적으로 없다.** 전부 Vercel 대시보드(또는 Vercel API) 설정이다.
리다이렉트를 `next.config.ts` 로 구현하고 싶어지더라도 하지 말 것 — 이유는 작업 1에 적었다.

레포를 건드려야 할 일이 생기면 `main` 에 직접 커밋한다(PR 없음, 이 레포 규칙).

## 1. 대상 정보

| 항목 | 값 |
| --- | --- |
| Vercel 팀 | `flexmania-1761's projects` (`team_6ngum30VcR6jV5Ae7ovdvxd6`) |
| 프로젝트 | `roxlogy` (`prj_mudCKKXdavhKkqqhgpRHKaGlZfhf`) |
| 연결된 레포 | `teenfo/roxlogy` — `main` 푸시 → production 자동 배포 |
| Root Directory | `web` (레포 루트가 모노레포, Next.js 앱은 `web/`) |
| 프레임워크 / Node | Next.js / 24.x |
| 리전 | `hnd1` — **정본은 `web/vercel.json`**, 대시보드에서 바꾸지 말 것 |
| 현재 붙어 있는 도메인 | `roxlogy.com`, `www.roxlogy.com`, `roxlogy.vercel.app`, 그 외 Vercel 자동 생성 URL |

---

## 작업 1 (필수) — apex 를 정본으로, `www` 는 308 리다이렉트

### 무엇을

- **`roxlogy.com` (apex) 을 Production 도메인으로 둔다.**
- **`www.roxlogy.com` 은 `roxlogy.com` 으로 308 Permanent Redirect.**

Vercel: Project → Settings → Domains 에서 `www.roxlogy.com` 의 동작을
`Redirect to roxlogy.com` / `308 Permanent Redirect` 로 설정한다.

### 왜 apex 인가 (이미 코드가 그렇게 정해져 있다)

방향을 반대로 잡으면 아래가 전부 어긋난다. 취향 문제가 아니다.

- `web/lib/site-url.ts` — `SITE_URL = "https://roxlogy.com"`
- `web/app/sitemap.ts`, `web/app/robots.ts` — `BASE = "https://roxlogy.com"`
- `android/app/build.gradle.kts` — 폰 앱이 WebView 로 여는 `WEB_APP_URL` 기본값이 `https://roxlogy.com`

특히 **로그인이 걸린다.** `web/components/auth-form.tsx` 는 OAuth·메일 인증의
`redirectTo` 를 `location.origin` 으로 만든다. `www` 로 들어온 사람이 로그인하면
`https://www.roxlogy.com/auth/callback` 이 되고, 그 URL 이 Supabase 의 Redirect URL
허용 목록에 없으면 로그인이 그대로 깨진다. 그래서 **앱에 닿기 전, 엣지에서** apex 로
넘겨야 한다.

### 코드로 구현하지 말 것

`next.config.ts` 의 `redirects()` 로도 되지만 그러면 요청이 함수까지 들어온 뒤에
튕긴다. Vercel 도메인 설정이 더 앞단이고, 바로 그 용도로 있는 설정이다.

### 검증

```bash
curl -sSI https://www.roxlogy.com/ | head -5
#   HTTP/2 308
#   location: https://roxlogy.com/

curl -sSI https://roxlogy.com/ | head -3
#   HTTP/2 200

curl -sS https://roxlogy.com/robots.txt      # Sitemap 이 apex 로 나오는지
curl -sS https://roxlogy.com/sitemap.xml | head -5
```

경로·쿼리가 보존되는지도 한 번 본다:

```bash
curl -sSI "https://www.roxlogy.com/pft?x=1" | grep -i location
#   location: https://roxlogy.com/pft?x=1
```

---

## 작업 2 — 환경 변수 점검

`web/` 이 실제로 읽는 값은 아래 여섯 개뿐이다(`process.env` 전수 조사 결과).
Production / Preview / Development 스코프에 각각 들어 있는지 확인한다.

| 변수 | 성격 | 필요 스코프 | 없으면 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 공개 | Prod · Preview · Dev | **빌드된 번들이 Supabase 클라이언트를 못 만든다 → 사이트 전체 500** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 공개(anon) | Prod · Preview · Dev | 위와 같음 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 공개 식별자 | Prod · Preview · Dev | `web/lib/push/config.ts` 기본값으로 폴백 |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | 공개 | Prod · Preview · Dev | Google One Tap 이 렌더링되지 않음(다른 로그인은 정상) |
| `HYROX_RESULT_API_BASE` | 서버 전용 | Prod (선택) | 기본 URL 사용 |
| `HYROX_RESULT_API_TOKEN` | **시크릿** | Prod | 대회 결과 검색·임포트 기능만 꺼진다(앱 나머지는 정상) |

### 이 작업에서 절대 하지 말 것

- **`SUPABASE_SERVICE_ROLE_KEY` 를 Vercel 에 넣지 말 것.** 웹은 anon 키 + RLS 로만
  접근한다(레포 `CLAUDE.md` 보안 규칙). service role 이 필요한 것은 Supabase Edge
  Functions 와 GitHub Actions 뿐이다.
- **`NEXT_PUBLIC_` 로 시작하는 값은 빌드 시 번들에 그대로 박힌다.** 비밀을 담지 말 것.
- 값을 어디에도 출력하지 말 것. 보고에는 **이름과 스코프 존재 여부만** 적는다.

---

## 작업 3 — Deployment Protection: 현재 상태를 확인하고, 원칙적으로 그대로 둔다

현재 상태:

- Vercel Authentication(SSO) **켜짐**, 범위 `all_except_custom_domains`
- Password Protection 꺼짐, Trusted IPs 꺼짐

즉 `roxlogy.com` / `www.roxlogy.com` 은 누구나 볼 수 있고, `*.vercel.app` 프리뷰
URL 은 Vercel 로그인이 필요하다. 운영 중인 공개 서비스에 맞는 설정이므로 **기본은
그대로 둔다.**

예외가 필요할 때: 공개 중계 보드(`/board/<code>`)를 프리뷰 배포로 남에게 보여 줄 일이
생기면, 그 배포에만 Protection Bypass 를 쓴다. **전체 Protection 을 끄지 말 것.**

---

## 작업 4 — 빌드·리전 설정 확인 (바뀐 게 없으면 손대지 않는다)

- Root Directory 가 `web` 인지
- Node 24.x 인지
- Build / Install / Output 이 기본값(Next.js 자동 감지)인지 — 커스텀 명령이 들어가 있으면
  왜 들어갔는지 확인하고, 이유가 없으면 기본값으로 되돌린다
- 리전은 `web/vercel.json` 의 `"regions": ["hnd1"]` 이 정본이다. 대시보드에서 따로
  지정해 두 곳이 어긋나게 만들지 말 것

---

## 작업 5 — 도메인·SSL 상태

Domains 화면에서 `roxlogy.com` 과 `www.roxlogy.com` 이 모두 **Valid Configuration**
이고 인증서가 정상인지 확인한다.

DNS 레코드 값은 **Vercel 이 그 화면에 표시하는 값을 그대로** 쓴다(권장 레코드는 바뀔 수
있으니 이 문서에 적힌 값을 외워 쓰지 말 것). 경고가 떠 있으면 어떤 경고인지 그대로
보고에 옮겨 적는다.

---

## Vercel 밖이지만 **리다이렉트를 바꾸기 전에** 같이 확인할 것

작업 1을 적용하면 로그인 왕복 경로가 바뀐다. 아래 둘이 어긋나 있으면 로그인이 깨지므로
**먼저** 확인한다.

1. **Supabase → Authentication → URL Configuration**
   - Site URL = `https://roxlogy.com`
   - Redirect URLs 에 `https://roxlogy.com/auth/callback` 포함
   - `https://www.roxlogy.com/auth/callback` 은 남겨 둬도 해롭지 않다(엣지에서 이미
     apex 로 넘어가 거의 쓰이지 않는다)
2. **Google Cloud Console → OAuth 클라이언트**
   - Authorized JavaScript origins 에 `https://roxlogy.com`
   - Authorized redirect URIs 에 Supabase 콜백 URL

이 두 곳은 **읽고 확인만** 하고, 값을 바꿔야 한다면 바꾸기 전에 사람에게 물을 것.

---

## 하지 말 것 (요약)

- service role 키를 Vercel 환경 변수에 넣지 말 것
- `.env` 를 커밋하지 말 것 (`web/.env.local.example` 만 커밋 대상)
- 리다이렉트를 코드로 구현하지 말 것
- 프로덕션 도메인을 `www` 로 바꾸지 말 것 (코드가 apex 를 하드코딩하고 있다)
- Deployment Protection 을 전체 해제하지 말 것
- 환경 변수 **값**을 로그·보고·커밋 어디에도 남기지 말 것

---

## 완료 보고에 넣을 것

1. `www` / apex `curl -I` 결과 (상태 코드와 `location` 헤더)
2. 환경 변수 여섯 개의 스코프별 존재 여부 — **이름과 있음/없음만**, 값은 쓰지 말 것
3. 실제로 바꾼 설정 목록 (바꾸기 전 → 후)
4. 로그인 1회 왕복 성공 여부 (`roxlogy.com` 에서 로그인 → 대시보드 진입)
5. Domains 화면에 남아 있는 경고가 있으면 그 문구 그대로
