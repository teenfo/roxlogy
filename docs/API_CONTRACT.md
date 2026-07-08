# S2 세션 수신 API 계약 (ingest-session)

> 2026-07-08 확정. 워치/폰/웹 공통 계약 — 마이그레이션 003의 멱등/LWW 규칙을 공식 API로 승격.
> 서버 구현: `supabase/functions/ingest-session` (Edge Function) + `public.ingest_session(p jsonb)` RPC (마이그레이션 005).

## 엔드포인트

```
POST https://vuloxbpfhyqkvgmpmkst.supabase.co/functions/v1/ingest-session
Authorization: Bearer <사용자 access token>   # Supabase Auth JWT (필수)
apikey: <anon/publishable key>
Content-Type: application/json
```

- `user_id`는 **보내지 않는다** — 서버가 토큰에서 결정한다. 타인 세션 id로 업서트를 시도하면 소유권 불일치로 조용히 무시된다(`applied=false`).
- service role 키는 클라이언트·Edge Function 어디에도 노출하지 않는다. RPC는 `auth.uid()` 기준으로 동작.

## 요청 스키마

```jsonc
{
  "session": {
    "id": "uuid",                    // 필수 — 클라이언트(워치) 생성 UUID
    "started_at": "ISO8601",         // 필수
    "ended_at": "ISO8601 | null",
    "total_time_ms": 3937000,
    "source_device": "watch|phone|web",   // 기본 watch
    "client_updated_at": "ISO8601",  // 필수 — LWW 판정 기준 (기기에서 마지막 수정한 시각)
    "deleted_at": "ISO8601 | null",  // 삭제 전파용 tombstone
    "template_id": "uuid | null"
  },
  "segments": [                      // 선택 — 주면 "전체 스냅샷"으로 해석 (아래 규칙 참조)
    {
      "id": "uuid",                  // 클라이언트 생성 권장 (없으면 서버 생성)
      "seq": 1,                      // 필수, 세션 내 1부터 연속
      "kind": "run|station|roxzone", // 필수
      "exercise_id": "uuid | null",  // 시드 01의 고정 UUID (web/lib/hyrox.ts와 일치)
      "machine_type": "ski|row|null",
      "split_time_ms": 267000,
      "started_at": "ISO8601 | null",
      "ended_at": "ISO8601 | null",
      "erg": {                       // 선택 — PM5 raw (세그먼트당 한 덩어리)
        "machine_type": "ski|row",
        "samples": [ { "t": 0, "dist": 0, "pace": 120.5, "spm": 32, "watts": 210, "cal": 0 } ]
      }
    }
  ]
}
```

## 멱등성 · LWW · 삭제 규칙

| 대상 | 충돌 키 | 규칙 |
|---|---|---|
| sessions | `(id)` | `client_updated_at`이 기존보다 **클 때만** 갱신 (LWW). 아니면 `applied=false, reason="stale"` — 재전송·구버전 데이터 안전 |
| session_segments | `(session_id, seq)` | 세션 LWW 통과 시에만 반영 |
| erg_samples | `(segment_id)` | 세그먼트당 raw 한 덩어리, 통째 교체 |

- **segments는 전체 스냅샷**: 배열을 주면 그 안의 최대 `seq`를 초과하는 기존 세그먼트는 삭제된다(칸 줄이기 동기화). 세그먼트를 건드리지 않으려면 `segments` 필드를 **생략**한다 (빈 배열 `[]`은 "세그먼트 전부 삭제"를 의미).
- **soft delete**: 한 번 `deleted_at`이 기록된 세션은 이후 업서트로 부활하지 않는다(tombstone 유지). 삭제 전파는 `session.deleted_at`을 설정해 보낸다.
- 업서트 성공 시 서버는 `analysis_status='pending'`으로 되돌려 hosub 워커 재분석을 큐잉한다.

## 페이로드 상한 (2026-07-08 확정)

| 항목 | 상한 | 초과 시 |
|---|---|---|
| 요청 본문 | **2MB** | `413 payload_too_large` |
| 세그먼트 수 | 64 | `400 invalid_segments` |
| erg 샘플 총합(세션당) | **30,000** (1Hz × 8세그먼트 × ~60분 여유) | `413 too_many_samples` |

## raw 다운샘플링 (확정)

- 클라이언트는 **원본 1Hz 샘플을 그대로 업로드**한다 (다운샘플 금지 — 원본 보존 원칙).
- 곡선 차트용 파생(세그먼트당 **≤120 포인트, LTTB**)은 hosub 워커가 `segment_metrics.pace_curve/power_curve`에 생성한다. 클라이언트는 파생을 만들지 않는다.

## 오프라인 보관 한도 (워치 로컬, 확정)

- 동기화 완료(`applied=true` 확인) 전 세션은 삭제 금지.
- 보관 한도: **최근 20세션 또는 72시간** 중 먼저 도달하는 쪽. 초과분은 오래된 것부터 삭제하되 미동기 세션은 예외.

## 응답

```jsonc
// 200 OK
{ "applied": true,  "session_id": "uuid", "segments_upserted": 24, "samples_upserted": 480 }
{ "applied": false, "session_id": "uuid", "reason": "stale" }   // LWW 탈락 or 소유권 불일치 — 재전송 불필요
```

| HTTP | error | 의미 |
|---|---|---|
| 400 | `invalid_json` / `invalid_session` / `invalid_segments` | 스키마 위반 (재전송해도 실패 — 페이로드 수정 필요) |
| 401 | `unauthenticated` | 토큰 없음/만료 — 재로그인 후 재시도 |
| 405 | `method_not_allowed` | POST만 허용 |
| 413 | `payload_too_large` / `too_many_samples` | 상한 초과 — 분할 불가(세션 단위 원자성)이므로 클라이언트 버그로 취급 |
| 500 | `internal` | 서버 오류 — 지수 백오프 재시도 (멱등이므로 안전) |

## 클라이언트 재시도 정책

- 네트워크 오류·5xx: 지수 백오프(2s, 4s, 8s… 최대 5회) 후 다음 동기화 주기로 이월. 멱등이므로 중복 전송 안전.
- 4xx: 재시도하지 않는다 (401만 토큰 갱신 후 1회 재시도).
