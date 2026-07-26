# AI 분석 워커 설치 — hosub 워커 + llm-gateway + Mac(LLM)

hosub 은 성능이 낮아 **LLM 추론은 Mac(Ollama)** 이 담당한다. 중간에는 hosub 의
**llm-gateway**(`/opt/hosub-mcp/llm-gateway`, `:8603`)가 있어 인증·역할→모델 매핑·
레인 큐·잡 영속화·모델 설치 승인을 담당한다. 워커는 HTTP 호출만 한다.

```
Supabase ←(outbound pull · service role)— hosub 워커
                                             │ HTTP :8603 (localhost, Bearer 토큰)
                                         llm-gateway ——(Tailscale)→ Mac Ollama :11434
```

보안:
- service role 키는 워커 `.env` 에만. Mac·게이트웨이는 Supabase 키를 갖지 않는다.
- 워커→게이트웨이는 **localhost**. 공개 URL(`https://hosub.duckdns.org/llm`)은 외부
  소비자(Vercel 등)용이며 토큰 인증 + 분당 30회 상한(roxlogy)이 걸려 있다.
- `LLMGW_TOKEN`(= 게이트웨이의 `LLMGW_TOKEN_ROXLOGY`)은 .env 전용, 커밋 금지.

생성 기능 (ai_insights 테이블, 사용자는 RLS 로 본인 것만 조회):
| kind | 트리거 | 표시 위치 | 역할(모델) |
|---|---|---|---|
| `session` | 지표 계산 완료 세션(`ai_status='pending'`) | 세션 상세 "AI 코칭" | `AI_ROLE` (기본 coach_feedback=32b) |
| `race` | 레이스 결과 등록 | 레이스 상세 "AI 레이스 분석" | 〃 |
| `weekly` | 매주 월요일(사용자 타임존) 지난주 종합 | 대시보드 "주간 훈련 리포트" | 〃 |

프롬프트는 이 레포(`worker/ai.py`) 소유 — 게이트웨이 roles.yaml 은 모델 정책만.
합계·격차는 워커가 미리 계산해 프롬프트에 넣는다(소형 모델 산술 오류 방지).

게이트웨이/Mac 이 꺼져 있으면 → LLM 작업만 pending 보류(지표 계산은 계속), 복구 시 자동 재개.

---

## 1. 사전 조건 (이미 완료된 것)

- llm-gateway 가동 중 (`docker compose`, `:8603`) — 상태: `curl -s localhost:8603/healthz`
- 게이트웨이 `config/services.yaml` 에 roxlogy 등록(역할 analyze_workout/coach_feedback/summarize)
- Mac Ollama 온라인 (Tailscale). Mac 설정·잠자기 방지는 게이트웨이의 `docs/mac-setup.md` 참조.
- `coach_feedback`(qwen2.5:32b) 첫 호출 시 모델이 없으면 게이트웨이가 **설치 요청**을
  올린다 → 대시보드(LLM → 모델 설치 요청) 또는 Claude(MCP `llm_decide_model`)로 승인.
  승인 전까지 해당 잡은 대기하고 다른 잡은 계속 돈다.

## 2. hosub 워커 배포

```bash
# 1) 코드 받기 (최초) 또는 갱신
git clone https://github.com/teenfo/roxlogy.git && cd roxlogy/worker
# (이미 있으면: cd roxlogy && git pull && cd worker)

# 2) 환경 구성 — 시크릿은 여기에만
cp .env.example .env
vi .env
#   SUPABASE_SERVICE_ROLE_KEY=...  ← Supabase 대시보드 → Settings → API (커밋 금지)
#   LLMGW_URL=http://127.0.0.1:8603
#   LLMGW_TOKEN=...                ← 게이트웨이 .env 의 LLMGW_TOKEN_ROXLOGY 값

# 3) Docker 빌드·기동
#    (localhost 게이트웨이 접근을 위해 host 네트워크 사용)
docker build -t roxlogy-worker .
docker run -d --restart unless-stopped --network host --env-file .env --name roxlogy-worker roxlogy-worker

# 4) 로그 확인
docker logs -f roxlogy-worker
#   [worker] start — poll every 10.0s, batch 5
#   [ai] session insight <id>                 ← LLM 생성 성공
#   [ai] llm-gateway 미응답(...) — LLM 작업 보류   ← 게이트웨이 중지(정상 동작, 재시도됨)
```

갱신 배포: `git pull && docker build -t roxlogy-worker . && docker rm -f roxlogy-worker && docker run -d --restart unless-stopped --network host --env-file .env --name roxlogy-worker roxlogy-worker`

## 3. 검증

1. hosub 로그에 `start —` 확인, 기존 pending 세션 지표가 `done` 으로 처리되는지.
2. 로그에 `[ai] session insight ...` 출현 → 웹 세션 상세에 **AI 코칭** 카드 표시.
3. 레이스 결과가 있으면 레이스 상세에 **AI 레이스 분석** 표시.
4. (다음 월요일 이후) 대시보드에 **주간 훈련 리포트** 표시.
5. 게이트웨이 중지 테스트 → `[ai] llm-gateway 미응답` 1회 로그 후 보류, 재기동 시 `복구` 로그와 재개.
6. 게이트웨이 사용량 귀속: MCP `llm_status` 의 usage 에 `service: roxlogy` 로 집계.

## 튜닝 (.env)

| 변수 | 기본 | 설명 |
|---|---|---|
| `AI_ROLE` | `coach_feedback` | 느리면 `analyze_workout`(14b) 으로 다운 (품질↓ 속도↑) |
| `AI_ENABLED` | `1` | `0` 또는 토큰 미설정이면 LLM 비활성(지표 계산만) |
| `AI_BATCH` | `3` | 폴링당 세션/레이스 LLM 처리 상한 (게이트웨이 30회/분 제한 고려) |
| `AI_WAIT_S` | `240` | generate 동기 대기 초 |
| `AI_JOB_POLL_S` | `600` | pending 잡 추가 폴링 초 (모델 설치 승인 대기 등) |
