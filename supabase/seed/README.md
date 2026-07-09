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

## ⚠️ 테스트 계정을 SQL로 직접 만들 때 (auth.users)

`auth.users`에 SQL로 직접 INSERT/UPDATE 해서 테스트 계정을 만들면 **로그인이
"Incorrect email or password"로 실패**할 수 있다. 원인은 비밀번호가 아니라
GoTrue가 로그인 시 읽는 토큰/체인지 컬럼이 **NULL**이면
`converting NULL to string is unsupported` 스캔 에러를 내고, 앱은 이를 일반
메시지로 표시하기 때문이다. (대시보드/가입 폼으로 만든 계정은 이 컬럼들이 빈
문자열이라 문제없다.)

**규칙: 이 컬럼들을 NULL이 아니라 빈 문자열 `''`로 둘 것.**

- 비밀번호는 bcrypt로: `crypt('비밀번호', gen_salt('bf'))`
- `email_confirmed_at`을 채워야 이메일/비밀번호 로그인이 됨
- `raw_app_meta_data`에 `{"provider":"email","providers":["email"]}` 포함
- 아래 컬럼을 모두 `''`로:
  `confirmation_token`, `recovery_token`, `email_change`,
  `email_change_token_new`, `email_change_token_current`,
  `phone_change`, `phone_change_token`, `reauthentication_token`

이미 NULL로 만들어진 계정을 고칠 때:
```sql
update auth.users set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  email_confirmed_at = coalesce(email_confirmed_at, now())
where email = '<대상 이메일>';
```

로그인 폼은 비밀번호 **8자 이상**을 요구하므로 테스트 비밀번호도 8자 이상으로.

## 운동 DB 확장 (360+, 한/영)
`exercises` 테이블은 Phase 1에서 이 앱 전용으로 독립 구축한다.
필드: name_ko, name_en, category, equipment[], station_type, media_url, description_ko.
전체 운동 DB(360+)는 확정 후 `10_exercises_full.sql`로 추가 예정 — 코어 세트(01)의
고정 UUID는 유지한다.
