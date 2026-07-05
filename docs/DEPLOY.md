# Roxlogy 웹 배포 런북 (Vercel)

> 확정 스택(PLANNING §2.4): 웹 프로덕션 = **Vercel**. hosub 개인 서버는 분석 워커
> 전용이며 웹 호스팅에 쓰지 않는다. main 푸시 = 자동 프로덕션 배포.

## 구조

```
GitHub(teenfo/roxlogy, main) ──자동──▶ Vercel (Root: web/) ──▶ *.vercel.app / roxlogy.com
                                          │ env: SUPABASE URL + anon key
                                          ▼
                                   Supabase Cloud (vuloxbpfhyqkvgmpmkst)
```

## 1. 최초 배포 (1회, ~10분)

1. [vercel.com](https://vercel.com) 가입 (GitHub 계정으로)
2. **Add New… > Project** → `teenfo/roxlogy` Import
3. 설정:
   | 항목 | 값 |
   |---|---|
   | Framework Preset | **Next.js** — Root Directory를 `web`으로 지정하면 자동 감지. "Other"로 나오면 드롭다운에서 Next.js 직접 선택 |
   | **Root Directory** | **`web`** ← 모노레포라 반드시 지정 |
   | Build Command / Output | 기본값 그대로 |
4. **Environment Variables** (Production + Preview 둘 다):
   | 이름 | 값 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://vuloxbpfhyqkvgmpmkst.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 대시보드 > Settings > API Keys의 **publishable** 키 |
   > ⚠️ service role 키는 어떤 경우에도 Vercel 환경변수에 넣지 않는다 (CLAUDE.md 보안 규칙 — 웹은 anon+RLS만).
5. **Deploy** → `https://<프로젝트>.vercel.app` 발급

## 2. Supabase Auth 리다이렉트 등록 (필수 — 빠뜨리면 이메일 인증 불능)

Supabase 대시보드 > **Authentication > URL Configuration**:
- **Site URL** = 배포 도메인 (예: `https://roxlogy.vercel.app`)
- **Redirect URLs**에 추가: `https://<도메인>/auth/callback`
- 커스텀 도메인 연결 시 그 도메인도 같은 방식으로 추가

## 3. 커스텀 도메인 연결 (`roxlogy.com` — 구입 확정 2026-07-05)

1. Vercel 프로젝트 > Settings > **Domains** > `roxlogy.com` 추가 (`www.roxlogy.com`도 함께 추가하고
   "Redirect to roxlogy.com" 선택)
2. 등록기관 DNS에 Vercel이 안내하는 레코드 입력 — Cloudflare 기준 상세는 §3.1
3. 연결 후 §2의 Auth URL을 `https://roxlogy.com` 기준으로 갱신
4. `web/app/sitemap.ts` / `robots.ts`의 BASE는 `https://roxlogy.com`으로 반영 완료 — 도메인이
   바뀌면 두 파일의 상수만 수정

### 3.1 Cloudflare DNS 세팅 (도메인을 Cloudflare에서 관리하는 경우)

Cloudflare 대시보드 > roxlogy.com > **DNS > Records**:

| Type | Name | Content | Proxy 상태 |
|---|---|---|---|
| A | `@` (roxlogy.com) | `76.76.21.21` | **DNS only (회색 구름)** |
| CNAME | `www` | `cname.vercel-dns.com` | **DNS only (회색 구름)** |

> ⚠️ **Proxy 상태를 반드시 "DNS only"로.** 주황 구름(Proxied)으로 두면 Cloudflare가 앞단에
> 끼면서 Vercel의 SSL 발급·도메인 검증이 실패하거나 리다이렉트 루프가 생긴다.
> SSL은 Vercel이 자동 발급하므로 Cloudflare 프록시 기능(캐시/방화벽)은 쓰지 않는 구성이 표준.
> 굳이 Proxied를 쓰려면 Cloudflare SSL/TLS 모드를 "Full (strict)"로 바꿔야 하지만 권장하지 않음.

- 기존에 등록기관 기본 A/CNAME(파킹 페이지 등)이 있으면 삭제
- 전파 후 Vercel Domains 화면에 "Valid Configuration" 표시되면 완료 (보통 수 분)

## 4. 배포 후 확인 체크리스트

- [ ] `/` 랜딩, `/predict` 계산기, `/events`에 대회 목록(시드 18건) 표시
- [ ] 가입 → 확인 메일 수신 → 링크 클릭 → `/auth/callback` → 대시보드 진입
- [ ] `/sessions/new`에서 세션 저장 → 상세 화면 차트·페이싱 등급 표시
- [ ] 다른 계정으로 로그인 시 타인 세션이 보이지 않음 (RLS)
- [ ] `/sitemap.xml`, `/robots.txt` 응답
- [ ] 존재하지 않는 주소 → 브랜드 404

## 5. 이후 배포

main에 푸시하면 Vercel이 자동으로 프로덕션 배포한다 (PR 없음 워크플로와 정합).
롤백은 Vercel 대시보드 > Deployments에서 이전 배포 **Promote to Production**.

## 부록 — CLI 대행 배포

Vercel 토큰을 발급(vercel.com > Settings > Tokens)해 세션 환경변수 `VERCEL_TOKEN`으로
제공하면 에이전트가 `npx vercel --prod`로 생성~배포를 대행할 수 있다
(실행 환경의 egress 정책이 vercel.com API를 허용해야 함).
