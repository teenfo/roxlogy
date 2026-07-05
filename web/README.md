# Roxlogy Web

Next.js(App Router) + Supabase 기반 웹 계층. 화면 구성과 데이터 계약은
루트 `CLAUDE.md` · `docs/PLANNING.md` 참조.

## 로컬 실행

```bash
cp .env.local.example .env.local   # 없으면 아래 표대로 직접 생성
npm install
npm run dev                        # http://localhost:3000
```

| 환경변수 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable(anon) 키 — service role 금지 |

## 주요 경로

| 경로 | 설명 |
|---|---|
| `app/` | 라우트 (공개: `/`, `/predict`, `/events` · 보호: `(app)/` 그룹) |
| `lib/analysis.ts` | 페이싱 등급 등 파생 지표 수식 (워커와 공유하는 기준 구현) |
| `lib/session-builder.ts` | 수동 입력 → 멱등 업서트 행 변환 (디바이스와 동일 계약) |
| `lib/hyrox.ts` | 스테이션 상수 (시드 01 고정 UUID와 일치 필수) |
| `proxy.ts` | 세션 리프레시 + 보호 경로 리다이렉트 |

## 배포

Vercel 자동 배포 (Root Directory = `web`). 절차·체크리스트는
[`docs/DEPLOY.md`](../docs/DEPLOY.md) 런북 참조.
