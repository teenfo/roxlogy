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
      "avg_hr": 152,          // 선택 — 세그먼트 평균 심박 bpm (워치 센서)
      "max_hr": 171,          // 선택 — 세그먼트 최대 심박 bpm
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

---

# 공식 레이스 기록 파이프라인 (HYROX Result API 연동)

레이스 기록이 어떤 경로로 등록되든 아래 보강이 자동 적용된다 (2026-08-25 확정).

## 등록 경로 3가지

| 경로 | 트리거 | 담당 |
|---|---|---|
| CI 자동 임포트 | 주간 sync + push/dispatch | `scripts/sync-athlete-results.mjs` |
| 웹 검색 임포트 | /races/new 이름 검색 → 가져오기 | `web/lib/hyrox-result-api.ts` → `race-new-form` |
| 수동 등록 | /races/new 직접 입력 | 다음 주간 CI가 ±3일 날짜 매칭으로 공식 값 보강 |

## CI 자동 임포트 (연동 사용자)

profiles.hyrox_person_ref 연동자 대상. 연동 ref 하나로는 더블·릴레이(등록명이 달라
ref가 갈라짐)를 못 보므로, **이름 검색(시즌 9→7)으로 이 인물의 모든 person_ref를
수집**해 각각의 결과를 임포트한다. 동명이인 방지: 검색으로 발견한 ref의 결과 행은
선수명에 본인 이름 포함 필수.

레코드당 저장 항목:
- 대회명: 이벤트 city에서 연도 제거 후 `HYROX {city}` (결과 행 event_name은 디비전×요일명이라 미사용)
- 날짜: 결과 행에 없음 → 이벤트 주말 범위에서 유도 (이벤트명의 요일 우선, 없으면 시작일)
- 디비전: division_name 정규식 + **더블은 검색 히트 sex(M/W/X)로 mixed 판별** (X→mixed_doubles)
- 시즌: 이벤트 슬러그 `season-N` → `20XX/YY (SN)` 라벨
- splits: stations/runs/roxzones + **stations_place/runs_place**(스플릿별 필드 순위) +
  **field_size**(이벤트 완주자 수) + **rank_overall** + **bib**
- 스플릿 조회: `/athletes/{athlete_id}/splits?result_id={결과행 id}` (구형 키 `run1_time` 등은 라벨 폴백 분류)
- 알림(race_imported) 발송

기존 기록 보강(멱등): ±3일 날짜(없으면 총기록 일치) 매칭 →
스플릿 없으면 전체 보강, 스플릿만 있으면 place/field/bib 백필,
결과 행에 bib 없으면 레이스 상세(`/athletes/{id}`)에서 재시도. 완결 기록은 스킵.

## bib 규약 (4+2)

`HHMM` + 2자리 순번 — 앞 4자리가 웨이브 출발시각(현지). 워치 실측으로 검증
(선전 bib 151045 ↔ 15:10:05 시작). 레이스 상세 헤더에 BIB 배지 표시,
레이스→세션 변환 시 세션 시작시각으로 사용 (`race-to-session-button`).

## 세그먼트 분포 모달

레이스 상세의 런/스테이션 클릭 → place/field_size 기반 정규분포 곡선 + 상위 N% +
내 레이스들의 같은 세그먼트 추이. place 없으면 순위/추이만 표시 (우아한 폴백).

## 주의

- 레이스 삭제 시 연결 세션은 보존되고 race_result_id만 끊긴다 — 재임포트 후 총기록 매칭으로 재연결 필요
- 서드파티 API는 구시즌·일부 기록에 bib/스플릿/요일이 빠질 수 있음 — 주간 sync가 재확인, 수동 입력한 bib은 덮어쓰지 않음
