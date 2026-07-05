# Supabase — 스키마 & RLS

## 마이그레이션 적용 순서
```
20260703000001_init_schema.sql      # 테이블 + 인덱스 + 트리거
20260703000002_rls_policies.sql     # RLS 정책 (조인 기반 소유권 판정 포함)
20260705000003_idempotency_lww.sql  # 멱등 업서트 키 + client_updated_at LWW + soft delete + session_metrics
```

Supabase Cloud 대시보드 > SQL Editor에 위 순서대로 붙여넣어 실행하거나,
Supabase CLI 사용 시 `supabase db push`로 적용.

## RLS 설계 핵심
- 사용자 데이터(profiles/sessions/segments/erg/metrics/race)는 **본인만 접근**.
- `session_segments` / `erg_samples` / `segment_metrics`는 직접 `user_id`가 없으므로
  **session을 경유(조인)해 소유권을 판정**한다. (기획서에서 미해결로 남겼던 부분 — 구현·검증 완료)
- `exercises`는 인증 사용자 공용 읽기.
- `programs`는 `is_public` 또는 본인 소유만. 하위(days/templates/items)는 상위 program 권한 상속.
- **파생 지표(`segment_metrics`/`session_metrics`) write는 hosub 워커(service role)가 RLS 우회**하여 수행.
  사용자에게는 select 정책만 부여.

## 멱등 업서트 / LWW 계약 (003 마이그레이션)
- 세션·세그먼트 `id`는 **클라이언트가 생성한 UUID**. 충돌 키:
  `sessions(id)`, `session_segments(session_id, seq)`, `erg_samples(segment_id)`.
- LWW 비교는 `sessions.client_updated_at`(기기 이벤트 시각) 기준.
  `updated_at`은 트리거가 채우는 **서버 수신 시각**이므로 충돌 판정에 쓰지 않는다.
  업서트 시 `... do update set ... where excluded.client_updated_at > sessions.client_updated_at`.
- 세션 삭제는 **soft delete**(`deleted_at` 기록). 조회는 `deleted_at is null` 필터 —
  오프라인 기기의 재동기화 업서트가 tombstone에 병합되므로 세션이 부활하지 않는다.

## 로컬 검증 방법 (PostgreSQL)
Supabase의 `auth.uid()` / `auth.role()` / `auth.users`를 스텁으로 만들고 마이그레이션 적용 후,
두 사용자로 데이터 격리를 확인한다. JWT 클레임은 트랜잭션 내에서 `set_config(...)`로 주입.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<user-uuid>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
-- 이후 쿼리는 해당 사용자 관점으로 RLS 적용됨
select count(*) from public.session_segments;
commit;
```

> ⚠️ 주의: `set_config(..., true)`는 **트랜잭션 로컬**이라 반드시 `begin;...commit;`으로 묶어야 한다.
> psql 자동커밋 상태에서 문장을 분리 실행하면 클레임이 소실되어 모든 행이 0건으로 보인다(스키마 버그 아님).

## 검증 결과 (2026-07-03)
| 관점 | sessions | segments | erg_samples | segment_metrics |
|---|---|---|---|---|
| User A (소유자) | 1 | 1 | 1 | 1 |
| User B (타인) | 0 | 0 | 0 | 0 |

→ 조인 기반 소유권 판정 정상. 타인의 세그먼트·raw·지표 접근 차단 확인.
