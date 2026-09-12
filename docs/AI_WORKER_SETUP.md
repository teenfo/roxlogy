# AI 분석 파이프라인 — 워커리스 (Edge `analysis-dispatch` + hosub llm-gateway + Mac)

**hosub 워커는 제거됐다** (2026-07-26 결정). llm-gateway 가 잡 큐·영속화·모델 정책을
담당하므로 별도 워커 컨테이너가 필요 없고, 오케스트레이션은 Supabase Edge Function 이 한다.

```
pg_cron(1분) → Edge `analysis-dispatch`
                 ├─ 1) 파생 지표: pending 세션 → session_metrics/segment_metrics
                 │      (구 worker/analyze.py 수식 이식 — web/lib/analysis.ts 일치, LTTB ≤120pt)
                 └─ 2) AI 인사이트: llm-gateway 에 잡 제출(wait=0) → 다음 크론에서 수령
                        │ HTTPS https://hosub.duckdns.org/llm (Bearer LLMGW_TOKEN)
                    hosub llm-gateway (/opt/hosub-mcp/llm-gateway, 역할·레인·잡 영속화)
                        │ Tailscale
                    Mac Ollama (coach_feedback = qwen2.5:32b)
```

- **비동기 잡 패턴**: 게이트웨이가 잡을 영속화하므로 Edge 는 제출만 하고 다음 크론에서
  결과를 수령 — Edge 실행시간 제한과 무관하게 32b 장시간 추론도 안전.
- **중복 안전**: 지표는 `analysis_status` pending→processing CAS, AI 는 `ai_jobs`
  부분 유니크 클레임. 게이트웨이/Mac 다운 시 클레임 회수 후 자동 재시도.
  완료 수령·프로그램 제출은 `ai_jobs_claim()` / `ai_jobs_submit_claim()` 로 10분 임대를
  잡은 실행만 처리한다(마이그레이션 088, 감사 A07). `claim_count` 가 5를 넘은 작업은 포기해
  영구 실패 작업이 무한 재시도되지 않는다. 프로그램 실체화는 `ai_materialize_program()`
  한 트랜잭션(A06) — 일부 INSERT 실패 시 빈 프로그램이 남지 않는다.
  운동 DB 에 없는 이름은 exercise_requests 에 pending 요청을 자동으로 남기고(마이그레이션
  089, 요청자 = 프로그램 소유자), 아이템은 exercise_id 없이 이름을 note 에 둔다 — 관리자가
  어드민 > 콘텐츠에서 승인하면 다음 생성부터 매칭된다.
- 프롬프트는 이 레포(`supabase/functions/analysis-dispatch`) 소유. 게이트웨이
  roles.yaml 은 모델 정책만 — 모델 교체는 게이트웨이 한 줄, 서비스 코드 무변경.
- 합계·격차는 함수가 미리 계산해 프롬프트에 주입(소형 모델 산술 오류 방지).

생성 기능 (ai_insights, RLS 로 본인 것만 조회):
| kind | 트리거 | 표시 위치 |
|---|---|---|
| `session` | 지표 계산 완료 세션 | 세션 상세 "AI 코칭" |
| `race` | 레이스 결과 등록 | 레이스 상세 "AI 레이스 분석" |
| `weekly` | 매주 월요일(사용자 타임존) 지난주 종합 | 대시보드 "주간 훈련 리포트" |

## 필요한 Edge Function 시크릿 (Supabase → Edge Functions → Secrets)

| 이름 | 값 |
|---|---|
| `LLMGW_URL` | `https://hosub.duckdns.org/llm` |
| `LLMGW_TOKEN` | 게이트웨이 `.env` 의 `LLMGW_TOKEN_ROXLOGY` 값 (**비밀 — 커밋 금지**) |
| `AI_ROLE` | (선택) 기본 `coach_feedback`(32b). 빠르게: `analyze_workout`(14b) |

시크릿 미설정이면 지표 계산만 동작하고 AI 는 `disabled` 로 응답에 표시된다.

## 검증

1. `select * from cron.job where jobname='roxlogy-analysis-dispatch'` — 등록 확인.
2. `net._http_response` 최근 행 — `{"ok":true,"metrics":N,...}` 200 응답.
3. 세션 저장 → 1~2분 내 지표 반영, LLM 제출(`submitted`) → 32b 추론 후 다음 크론에서
   수령(`collected`) → 웹 세션 상세에 **AI 코칭** 카드.
4. 게이트웨이 사용량 귀속: hosub MCP `llm_status` 의 usage 에 `service: roxlogy`.
5. 게이트웨이 다운 테스트: 제출 실패 → 클레임 회수 → 복구 후 자동 재개.

## 보안 메모

- Mac·게이트웨이는 Supabase 키를 갖지 않는다. service role 은 Edge env(자동)에만.
- 게이트웨이 공개 URL 은 Bearer 토큰 + roxlogy 분당 30회 상한. 토큰이 새도 소비량 상한.
- hosub "인바운드 금지" 원칙의 예외는 llm-gateway(Caddy TLS + 토큰 인증) 하나로 한정.
