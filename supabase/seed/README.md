# Seed 데이터

## 파일
| 파일 | 내용 | 성격 |
|---|---|---|
| `01_exercises_core.sql` | HYROX 8스테이션 + 러닝 (한/영, 고정 UUID) | 공용 마스터 — 모든 환경에 적용 |
| `02_dev_session.sql` | 테스트 세션 1회분 (8런+8스테이션+록스존, 에르그 raw 포함) | **개발/검증 전용** — 프로덕션 금지 |

모두 003 마이그레이션의 멱등 키(`on conflict`)를 사용해 **재실행 안전**.

## 적용 방법
1. `01_exercises_core.sql` — SQL Editor(또는 MCP `execute_sql`)에서 그대로 실행
2. `02_dev_session.sql` — 파일 내 `TARGET_USER_UUID`를 실제 가입 유저의
   `auth.users.id`로 치환한 뒤 실행 (01 선행 필수)

## 운동 DB 확장 (360+, 한/영)
`exercises` 테이블은 Phase 1에서 이 앱 전용으로 독립 구축한다.
필드: name_ko, name_en, category, equipment[], station_type, media_url, description_ko.
전체 운동 DB(360+)는 확정 후 `10_exercises_full.sql`로 추가 예정 — 코어 세트(01)의
고정 UUID는 유지한다.
