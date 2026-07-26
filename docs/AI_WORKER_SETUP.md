# AI 분석 워커 설치 — hosub(브릿지) + Mac(LLM)

hosub 은 성능이 낮아 **LLM 추론은 같은 네트워크의 Mac(M4 Max 48GB)** 이 담당하고,
hosub 워커는 **브릿지**로서 Supabase 큐를 폴링해 LLM 작업만 Mac(Ollama)으로 위임한다.

```
Supabase ←(outbound pull · service role)— hosub 워커 —(LAN HTTP :11434)→ Mac (Ollama)
```

보안 원칙 (CLAUDE.md):
- hosub: **outbound pull 전용**, 인바운드 포트 개방 금지. service role 키는 hosub `.env` 에만.
- Mac: **Supabase 키를 갖지 않는다.** Ollama API 를 LAN 에만 노출(공유기 포트포워딩 금지).

생성 기능 (ai_insights 테이블, 사용자는 RLS 로 본인 것만 조회):
| kind | 트리거 | 표시 위치 |
|---|---|---|
| `session` | 지표 계산 완료된 세션(`ai_status='pending'`) | 세션 상세 "AI 코칭" |
| `race` | 레이스 결과 등록 | 레이스 상세 "AI 레이스 분석" |
| `weekly` | 매주 월요일(사용자 타임존) 지난주 종합 | 대시보드 "주간 훈련 리포트" |

Mac 이 꺼져 있으면 → LLM 작업만 pending 보류(지표 계산은 계속), Mac 이 살아나면 자동 재개.

---

## 1. Mac 설정 (M4 Max 48GB)

```bash
# Ollama 설치 + 모델 (qwen2.5:32b — Apache 2.0, 한국어 우수, 48GB 에 여유)
brew install ollama
ollama pull qwen2.5:32b

# LAN 바인딩으로 서비스 기동 (기본은 127.0.0.1 만 수신이라 hosub 이 못 붙음)
launchctl setenv OLLAMA_HOST "0.0.0.0"
brew services restart ollama

# 확인 (Mac 에서)
curl http://localhost:11434/api/tags
```

- Mac 의 LAN IP 고정 권장: 시스템 설정 → 네트워크 → DHCP 고정 임대(또는 공유기에서 IP 예약).
- **잠자기 방지**: 시스템 설정 → 배터리/에너지 → "디스플레이 꺼져도 잠자지 않음" (안 하면 Mac 잠들 때 리포트 생성이 보류됨 — 치명적이진 않음).
- 방화벽을 켰다면 ollama 수신 허용. 공유기 밖(인터넷)으로 11434 를 열지 말 것.

## 2. hosub 배포

```bash
# 1) 코드 받기 (최초) 또는 갱신
git clone https://github.com/teenfo/roxlogy.git && cd roxlogy/worker
# (이미 있으면: cd roxlogy && git pull && cd worker)

# 2) 환경 구성 — 시크릿은 여기에만
cp .env.example .env
vi .env
#   SUPABASE_SERVICE_ROLE_KEY=...   ← Supabase 대시보드 → Settings → API (커밋 금지)
#   OLLAMA_URL=http://<Mac의_LAN_IP>:11434
#   OLLAMA_MODEL=qwen2.5:32b

# 3) Docker 빌드·기동
docker build -t roxlogy-worker .
docker run -d --restart unless-stopped --env-file .env --name roxlogy-worker roxlogy-worker

# 4) 로그 확인
docker logs -f roxlogy-worker
#   [worker] start — poll every 10.0s, batch 5
#   [ai] session insight <id>          ← LLM 생성 성공
#   [ai] ollama 미응답(...) — LLM 작업 보류  ← Mac 꺼짐(정상 동작, 재시도됨)
```

갱신 배포: `git pull && docker build -t roxlogy-worker . && docker rm -f roxlogy-worker && docker run -d --restart unless-stopped --env-file .env --name roxlogy-worker roxlogy-worker`

## 3. 검증

1. hosub 로그에 `start —` 확인, 기존 pending 세션 지표가 `done` 으로 처리되는지.
2. Mac 켠 상태에서 로그에 `[ai] session insight ...` 출현 → 웹 세션 상세에 **AI 코칭** 카드 표시.
3. 레이스 결과가 있으면 레이스 상세에 **AI 레이스 분석** 표시.
4. (다음 월요일 이후) 대시보드에 **주간 훈련 리포트** 표시.
5. Mac 을 꺼보기 → `[ai] ollama 미응답` 1회 로그 후 조용히 보류, 켜면 `복구` 로그와 함께 재개.

## 튜닝 (.env)

| 변수 | 기본 | 설명 |
|---|---|---|
| `OLLAMA_MODEL` | `qwen2.5:32b` | 느리면 `qwen2.5:14b` 로 다운 (품질↓ 속도↑) |
| `AI_ENABLED` | `1` | `0` 이면 LLM 전체 비활성(지표 계산만) |
| `AI_BATCH` | `3` | 폴링당 세션/레이스 LLM 처리 상한 |
| `AI_NUM_PREDICT` | `700` | 응답 토큰 상한 |
