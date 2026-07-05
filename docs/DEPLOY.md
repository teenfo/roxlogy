# Roxlogy 웹 배포 런북 (Vercel)

> 확정 스택(PLANNING §2.4): 웹 프로덕션 = **Vercel**. hosub 개인 서버는 분석 워커
> 전용이며 웹 호스팅에 쓰지 않는다. main 푸시 = 자동 프로덕션 배포.

## 구조

```
GitHub(teenfo/roxlogy, main) ──자동──▶ Vercel (Root: web/) ──▶ *.vercel.app / roxlogy.app
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

## 3. 커스텀 도메인 (선택 — 기획상 조기 선점 권장)

1. `roxlogy.app` 구매 (아무 등록기관)
2. Vercel 프로젝트 > Settings > **Domains** > 도메인 추가 → 안내되는 DNS 레코드 등록
3. 연결 후 §2의 Auth URL을 커스텀 도메인 기준으로 갱신
4. `web/app/sitemap.ts` / `robots.ts`의 BASE는 이미 `https://roxlogy.app` — 다른
   도메인을 쓰게 되면 두 파일의 상수만 수정

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
