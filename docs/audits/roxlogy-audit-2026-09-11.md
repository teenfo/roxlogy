# Roxlogy 기술 감사 보고서

**감사일:** 2026-09-11  
**대상:** `teenfo/roxlogy` · `main`  
**기준 커밋:** `3ab32b66b36473872f1a637e8bb69086a46c0077`  
**방식:** 읽기 전용 소스 감사 및 외부 통신 없는 모의 검증  
**변경 사항:** 프로젝트 코드·설정·DB·배포·저장소 공개 범위 변경 없음

## 1. 종합 의견

**기능 구성은 폭넓지만, 자격증명 회수와 계정 정지의 실효성, 비동기 처리의 완료 판정에 우선 보완이 필요하다.** 이번 감사에서는 코드로 확인한 발견 사항 9건을 정리했다. 우선순위는 P1 4건, P2 5건이다. 별도로 운영 환경 확인이 필요한 항목 5건을 분리했다. 이 수치는 서비스 전체의 취약점 총수를 뜻하지 않는다.

가장 먼저 처리할 항목은 **MCP 토큰 재발급 실패(A01)**와 **정지 계정의 API 접근 차단 누락(A02)**이다. 두 문제가 함께 있으면 토큰이 유출되거나 계정을 정지해야 할 때 사용자가 정상 화면에서 접근을 회수하기 어렵다. 다음은 **분석·AI 저장 실패를 성공으로 처리하는 문제(A06)**와 **대회 동기화 삭제 범위의 불완전성(A08)**이다.

운영 장애나 침해 사고가 이미 발생했다고 판정한 것은 아니다. 운영 DB에 적용된 마이그레이션, 실제 권한, 외부 게이트웨이 설정은 직접 조회하지 않았다. SQL 관련 판단은 저장소의 마이그레이션이 순서대로 적용됐다는 조건에 기반한다.

| ID | 우선순위 | 발견 사항 | 근거 수준 |
| --- | --- | --- | --- |
| A01 | P1 | MCP 토큰 재발급 요청을 DB 가드가 거부하며 UI가 오류를 숨김 | 코드·후속 마이그레이션 교차 확인 |
| A02 | P1 | 계정 정지가 앱 화면에만 적용되고 MCP·DB 경로에서는 확인되지 않음 | 인증·RLS·RPC 경로 추적 |
| A03 | P2 | MCP를 읽기 전용으로 안내하지만 동일 토큰에 쓰기 기능 제공 | 화면 문구·도구 등록 교차 확인 |
| A04 | P2 | 비로그인 ICS 구독 요청이 로그인 페이지로 이동 | 원본 proxy 함수 모의 실행 |
| A05 | P2 | 푸시 실패 전에 발송 완료로 표시해 재시도 대상에서 제외 | 원본 발송 함수 실패 주입 |
| A06 | P1 | 분석 지표·AI 프로그램의 저장 실패를 성공으로 처리 | 원본 함수 실패 주입 2건 |
| A07 | P2 | AI 작업 수령·프로그램 생성에 동시 실행 클레임 부족 | 실행 순서 분석 |
| A08 | P1 | 동기화가 완전성을 입증하지 못한 시즌까지 삭제 후보로 판단 가능 | 수집·병합·삭제 범위 추적 |
| A09 | P2 | 웹·DB 권한 회귀를 자동 차단하는 저장소 내 검증 체계 부족 | 파일 목록·워크플로·스크립트 확인 |

P1은 다음 운영 변경에서 우선 다룰 보안 또는 데이터 무결성 문제, P2는 계획적으로 보완할 기능·신뢰성·통제 문제다. CVSS 점수나 규제 적합성 판정을 부여하지 않았다.

## 2. 범위와 검증 한계

저장소 트리에서 파일 604개를 확인하고, 텍스트 소스·설정·문서 490개를 고정 커밋으로 수집해 검색했다. 이 중 SQL 마이그레이션은 154개다. 전체 파일을 동일한 깊이로 전수 검증한 것은 아니며, 다음 위험 경로를 중심으로 상세 검토했다.

| 영역 | 검토 내용 | 한계 |
| --- | --- | --- |
| 웹·MCP | 인증 proxy, API route, MCP 토큰, 설정 화면, 캘린더 구독 | 실제 브라우저·Vercel 배포 실행 미검증 |
| Supabase | 마이그레이션의 RLS, 특권 컬럼 가드, RPC, 권한 회수, 최신 재정의 | 운영 ACL·트리거 설치·마이그레이션 적용 상태 미조회 |
| Edge Functions | 세션 수신, 분석·AI, 푸시 큐와 직접 발송 | 실제 Edge 런타임·외부 발송·LLM 호출 없음 |
| 동기화 | 대회 수집·병합·삭제, 스케줄 설정 | 유료 API나 운영 레코드에 대한 실행 없음 |
| 모바일 | Android WebView·네이티브 브리지·인증 저장 및 동기화 경로 표본 | 기기·BLE·배터리·백그라운드 동작 미검증 |
| CI·운영 | GitHub 워크플로 정의와 최근 실행 기록 | 외부 CI·Vercel 프로젝트 설정·브랜치 보호 미검증 |

`web/package-lock.json`의 존재는 확인했다. 이미지·바이너리, 시드/대회 데이터 본문, lockfile의 전체 의존성 보안 분석과 전체 Git 이력 비밀정보 검사는 이번 범위에 포함하지 않았다. 웹 빌드, Android 빌드, DB 마이그레이션 실행도 하지 않았다.

모의 검증에서는 원본 TypeScript의 타입·외부 import를 실행용 메모리에서 제거하고 인증·DB·발송 모듈만 가짜 응답으로 대체했다. 네트워크 함수는 차단했다. 따라서 실제 코드의 제어 흐름은 검증하지만 실제 Supabase·Next.js·Deno 통합 동작을 인증하는 결과는 아니다.

## 3. 상세 발견 사항

### A01 · P1 · MCP 토큰 재발급 실패와 오류 미표시

**근거:** [mcp-connect.tsx:29](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/components/mcp-connect.tsx#L29), [profiles_privileged_guard:18](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260907000042_admin_user_detail.sql#L18).

설정 화면의 `regen()`은 새 토큰을 만든 뒤 `profiles.mcp_token`을 직접 UPDATE한다. 반면 9월 7일 마이그레이션의 `profiles_privileged_guard`는 일반 클라이언트가 해당 컬럼을 변경하면 관리자 여부와 관계없이 `profile_token_locked`를 발생시킨다. 토큰 재발급을 위한 별도 서버 RPC 호출은 현재 화면에 없다. 오류가 있으면 화면을 새로고침하지 않을 뿐 사용자에게 오류를 표시하지 않는다.

**영향:** 사용자가 재발급 버튼을 눌러도 기존 토큰이 유지된다. 유출된 자격증명이나 더 이상 신뢰하지 않는 MCP 연결을 정상 UI에서 회수하지 못한다. DB 운영자가 직접 회수할 수 없다는 뜻은 아니다.

**확인 시나리오:** 해당 마이그레이션이 적용된 검증 환경에서 로그인 후 재발급 → UPDATE 거부 → 기존 토큰 유지. 일반 사용자뿐 아니라 관리자 클라이언트에도 같은 토큰 가드가 적용된다. 운영 환경에서 이 요청은 실행하지 않았다.

**권고:** 본인 인증을 검증하고 서버에서 난수를 생성하는 전용 재발급 RPC를 제공한다. 기존 토큰의 즉시 무효화와 클라이언트 성공·실패 표시를 한 흐름으로 검증한다. 일반 UPDATE 가드를 제거하는 방식으로 해결하지 않는다.

**완료 기준:** 새 토큰으로는 접근되고 이전 토큰은 거부되며, 서버 실패 시 UI에 명확한 오류가 표시된다.

### A02 · P1 · 정지 계정의 API 접근 경로가 남음

**근거:** [(app)/layout.tsx:19](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/app/(app)/layout.tsx#L19), [mcp_uid:19](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260825000006_mcp_api.sql#L19), [sessions RLS:197](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260830000027_policy_consolidation.sql#L197), [ingest_session](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260830000026_ingest_session_web_fields.sql), [관리자 프로필 변경](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260907000053_profile_instagram.sql).

앱 레이아웃은 `profile.disabled`가 참이면 정지 화면을 표시한다. 하지만 MCP 공통 사용자 판정인 `mcp_uid()`는 토큰 일치만 검사한다. 세션 RLS·수신 RPC도 소유자 또는 로그인 여부를 검사하면서 정지 상태는 확인하지 않는다. 관리자 변경은 프로필의 `disabled` 값을 바꾸며, 이 경로에서 Auth 세션을 회수하거나 MCP 토큰을 무효화하는 처리는 확인되지 않았다.

**영향:** 정지 사용자의 기존 MCP 토큰이나 유효 JWT로 직접 호출하면 화면을 거치지 않는 데이터 접근·일부 변경 경로가 유지될 수 있다. 크루 운영진 권한도 남아 있다면 MCP 쓰기 도구의 영향 범위가 커진다. 다른 사용자 권한을 자동 획득하는 문제로 확대 해석하지 않는다.

**권고:** 계정 활성 여부를 DB/RPC 및 외부 API의 공통 인가 조건으로 적용한다. MCP는 `mcp_uid()`뿐 아니라 토큰을 직접 조회하는 기존 RPC도 함께 점검한다. 정지 처리 시 토큰 회수 정책을 정의하고 기존 세션에 대한 차단 검증을 포함한다.

**완료 기준:** 정지 전 발급한 JWT·MCP 토큰으로 앱, 직접 REST, RPC, Edge, MCP를 호출해도 보호된 동작이 거부된다. 공개 참조 데이터의 익명 조회는 별도 정책으로 유지한다.

### A03 · P2 · MCP의 읽기 전용 안내와 실제 권한 불일치

**근거:** [MCP 설정 화면:57](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/components/mcp-connect.tsx#L57), [한국어 문구:1145](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/lib/i18n/dictionaries/ko.ts#L1145), [MCP 도구 등록](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/app/api/mcp/route.ts).

화면은 “읽기 전용”이라고 표시하지만 동일한 MCP 서버에는 회계 기록, 모임 등록, 가입 승인, 등급 변경, 프로그램 생성, 출석·회비 처리 등 쓰기 도구가 등록돼 있다. 사용자·크루 역할 검사는 존재하지만 토큰별 읽기/쓰기 동의나 권한 범위 선택은 확인되지 않는다.

**영향:** 사용자는 조회만 허용한다고 생각하고 실제로는 자신의 역할에 따른 변경 권한까지 외부 AI 클라이언트에 전달한다. 도구 설명의 “실행 전 확인” 문구는 유용하지만 서버가 강제하는 읽기 전용 권한은 아니다.

**권고:** 안내를 실제 기능과 일치시키고 토큰에 읽기·쓰기 범위를 명시한다. 분석용 기본 연결은 읽기 권한만 주고 회계·운영 변경은 별도 범위로 선택하게 한다.

**완료 기준:** 읽기 전용 토큰으로 모든 변경 RPC를 거부하고, 쓰기 연결 화면에서 실제 허용 동작을 확인할 수 있다.

### A04 · P2 · 외부 캘린더 구독이 로그인 proxy에 차단됨

**근거:** [proxy.ts](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/proxy.ts), [calendar.ics route](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/app/(app)/programs/[id]/calendar.ics/route.ts), [구독 URL 생성:26](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/components/program-calendar-subscribe.tsx#L26).

ICS route는 `?token=`을 가진 비로그인 캘린더 서버 요청을 지원한다. 그러나 proxy의 보호 경로에는 `/programs`가 포함돼 있고 matcher의 정적 확장자 제외 목록에는 `.ics`가 없다. route가 토큰을 검증하기 전에 로그인하지 않은 요청을 `/login?next=...`로 보낸다.

**재현:** 원본 proxy 함수에 로그인 세션이 없는 `/programs/example/calendar.ics?token=synthetic` 요청을 전달했다. matcher가 참으로 평가됐고 응답은 로그인 URL을 가리키는 307 리다이렉트였다. 토큰 진위를 검사하는 route까지 도달하지 않았다.

**영향:** 로그인된 브라우저의 직접 다운로드는 정상일 수 있지만 Google·Apple 등 서버 측 구독은 ICS 대신 로그인 응답을 받을 수 있다.

**권고:** 정확한 ICS 경로를 proxy 로그인 검사에서 분리하고 route 자체에서 토큰을 검증한다. `/programs` 전체를 공개하는 방식은 피한다.

**완료 기준:** 쿠키 없는 유효 구독은 `200 text/calendar`, 잘못된 토큰은 거부 응답을 받으며 일반 프로그램 화면의 로그인 보호는 유지된다.

### A05 · P2 · 푸시 전송 실패가 재시도 불가능한 완료 상태로 남음

**근거:** [push-dispatch:65](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/push-dispatch/index.ts#L65), [발송·예외 처리:99](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/push-dispatch/index.ts#L99).

큐를 가져올 때 `sent_at`을 먼저 기록한다. 그 뒤 외부 발송이 실패해도 `failed` 카운터만 늘리고 상태를 되돌리거나 다음 재시도를 예약하지 않는다. FCM/VAPID 설정 문제나 구독 조회 오류로 실제 발송이 없어도 같은 완료 표시가 남을 수 있다.

**재현:** Web Push 모듈에 503 오류를 주입했다. 첫 실행은 `dispatched=1, sent=0, failed=1`이었지만 행은 이미 완료 표시가 됐다. 다음 실행은 `dispatched=0`이어서 재시도하지 않았다.

**영향:** 일시적인 외부 장애가 알림 누락으로 굳어진다. 인앱 알림 행 자체가 삭제되는 문제는 아니다. “정확히 한 번 발송”이라는 주석은 실제 외부 전송 성공 보장과 다르다.

**권고:** 처리 중 상태·임대 만료 시각과 실제 전송 완료를 분리한다. 일시 실패에는 제한된 재시도와 백오프를 적용하고, 여러 기기 중 일부만 성공한 경우도 추적한다.

**완료 기준:** 503·타임아웃·실행 중단 후 복구 시 성공하지 않은 대상이 다시 처리되고 성공하지 않은 행에 완료 시각이 남지 않는다.

### A06 · P1 · 분석·AI DB 저장 실패를 성공으로 판정

**근거:** [materializeProgram:425](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/analysis-dispatch/index.ts#L425), [지표 저장:532](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/analysis-dispatch/index.ts#L532), [AI 결과 수령:570](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/analysis-dispatch/index.ts#L570).

지표 upsert의 `{ error }`를 검사하지 않고 세션을 `analysis_status='done'`으로 바꾼다. AI 프로그램 생성에서는 상위 프로그램 INSERT 이후 일차·워크아웃 INSERT 실패를 건너뛰며, 아이템 INSERT 결과도 검사하지 않고 프로그램 ID를 반환한다. AI 인사이트 교체는 DELETE 후 INSERT를 개별 수행하면서 오류를 확인하지 않는 경로가 있다.

**재현 1:** `session_metrics` 저장이 오류 객체를 반환하도록 했다. 함수는 `metrics=1, failed=0`을 반환하고 세션 상태를 `done`으로 바꿨다.

**재현 2:** 상위 프로그램 생성만 성공하고 일차 INSERT가 실패하게 했다. `materializeProgram()`은 성공을 의미하는 프로그램 ID를 반환했다.

**영향:** 빈 프로그램, 누락된 지표, 성공 알림과 실제 저장 상태의 불일치가 발생할 수 있다. 인사이트 교체 과정에서는 기존 결과 삭제 후 새 결과 저장에 실패할 위험도 있다.

**권고:** 모든 DB 쓰기 결과를 확인한다. 프로그램 전체 실체화와 인사이트 교체는 트랜잭션 또는 동등한 원자적 저장 단위로 처리한다. 완료 상태·알림·작업 삭제는 저장 성공이 확정된 뒤에 수행한다. Supabase 공식 예제도 반환값의 `data`와 `error`를 구분한다. [공식 upsert 문서](https://supabase.com/docs/reference/javascript/upsert)

**완료 기준:** 하위 저장 실패 시 성공 ID·완료 상태·성공 알림을 반환하지 않으며, 재시도 후 데이터가 정확히 한 번 완성된다.

### A07 · P2 · AI 수령 단계의 동시 실행 중복 가능성

**근거:** [AI 작업 수령:570](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/analysis-dispatch/index.ts#L570), [프로그램 요청 제출:627](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/analysis-dispatch/index.ts#L627).

세션 지표 단계에는 `pending → processing` 조건부 갱신이 있지만, 완료된 AI 작업을 수령하는 단계는 `ai_jobs`를 SELECT한 다음 프로그램 생성·알림·작업 삭제를 수행한다. 수령자 하나만 작업을 소유하도록 하는 상태 전환이나 임대가 없다. 프로그램 요청 제출 역시 `job_id is null`을 조회한 뒤 외부 제출이 끝나야 ID를 기록한다.

**영향:** 두 실행이 겹치면 같은 작업을 둘 다 읽어 프로그램이 중복 생성되거나 완료 알림이 중복될 수 있다. 요청 큐의 유니크 인덱스는 “같은 기존 작업을 두 소비자가 처리하는 것”까지 막지 않는다. 외부 게이트웨이의 중복 방지 여부는 확인하지 않았다.

**권고:** 제출과 수령 양쪽에 원자적 클레임·임대 만료·복구를 둔다. 생성 프로그램에 원본 작업 ID를 연결하고 DB 유니크 제약으로 실체화의 중복을 막는다.

**완료 기준:** 두 처리기를 동시에 실행해도 한 작업에서 프로그램·완료 알림이 중복되지 않고, 처리기 중단 시 다른 실행이 안전하게 이어받는다.

### A08 · P1 · 대회 삭제 판단의 시즌 완전성 보장 부족

**근거:** [페이지 수집:406](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/scripts/sync-race-events.mjs#L406), [시즌 수집·병합:478](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/scripts/sync-race-events.mjs#L478), [complete 반환:580](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/scripts/sync-race-events.mjs#L580), [삭제 대상 시즌:651](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/scripts/sync-race-events.mjs#L651), [삭제 보호:710](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/scripts/sync-race-events.mjs#L710).

API에서는 현재·직전 시즌만 받지만, 큐레이션 전체와 병합한 뒤 `complete: true`를 반환한다. 기존 데이터 조회의 시즌 목록은 API에서 완전히 가져온 시즌이 아니라 최종 병합 행 전체에서 만든다. 큐레이션에 다른 시즌이 포함되는 조건에서는 그 시즌의 API 전용 행도 누락 데이터로 판단할 수 있다.

또한 페이지 반복은 20페이지에서 끝나며 실제 마지막 페이지에 도달했는지 완전성 반환값으로 확인하지 않는다. 삭제 전 참조 검사와 10건 상한은 존재하지만 1~10건의 잘못된 삭제를 막는 조건은 아니다.

**영향:** 시즌 전환·부분 응답·데이터 증가 상황에서 정상 대회가 삭제 후보로 분류될 수 있다. 현재 운영 데이터에서 실제 삭제가 발생했다고 확인한 것은 아니다.

**권고:** 수집 완료를 확인한 시즌 집합을 별도 전달하고 삭제는 그 집합에만 한정한다. 페이지 상한 도달이나 비정상 축소는 완전하지 않은 응답으로 처리한다. 삭제 전후 이력과 복구 가능한 보관을 둔다.

**완료 기준:** 과거 시즌 큐레이션이 섞인 경우, 마지막 페이지가 누락된 경우, API가 빈 배열을 정상 응답한 경우에도 수집 완전성이 입증되지 않은 범위에서는 삭제하지 않는다.

### A09 · P2 · 웹·DB 회귀 검증의 자동 차단 장치 부족

**근거:** [워크플로 목록](https://github.com/teenfo/roxlogy/tree/3ab32b66b36473872f1a637e8bb69086a46c0077/.github/workflows), [web/package.json](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/package.json), [Android CI](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/.github/workflows/android.yml), [프로젝트 운영 규칙](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/CLAUDE.md).

Android 공유 모듈에는 테스트 파일 6개와 `:shared:test` 실행이 있다. 반면 수집한 저장소 구조에는 웹 전용 테스트 스위트와 독립된 DB 권한 테스트 디렉토리가 없고, GitHub 워크플로에서 웹 lint·권한 회귀 테스트를 필수 실행하는 구성은 확인되지 않는다. 마이그레이션에 일부 검증용 DO 블록은 있어 “DB 검증이 전혀 없다”고 판단하지 않는다. Vercel의 외부 자동 빌드도 이번에 확인하지 않았다.

**영향:** A01 같은 프론트엔드와 보안 트리거 간 계약 불일치, A04 같은 proxy와 route 간 충돌이 개별 코드 점검만으로 통과하기 쉽다. 최근 동기화 실행 성공은 이러한 경로의 검증을 대신하지 못한다.

**권고:** 기존 개발 워크플로를 유지하더라도 웹 lint·타입 검증, MCP 토큰 회수, 정지 사용자, 비로그인 ICS, 권한별 RPC 허용·거부, 비동기 실패 주입을 자동 검증한다. DB 검증은 익명·일반 회원·운영진·관리자 및 타 크루 사용자를 구분한다.

**완료 기준:** 이번에 확인한 회귀 조건을 의도적으로 다시 넣었을 때 자동 검증이 실패하고, 수정된 상태에서 통과한다.

## 4. 추가 확인이 필요한 위험과 운영 항목

아래 항목은 코드상의 통제 부족 또는 설정 불일치다. 실제 침해 가능성·영향은 운영 환경을 확인한 뒤 확정해야 하며 위 9건의 집계에 포함하지 않았다.

### R01 · 저장소 공개 범위와 사용자 의도 불일치

앞선 GitHub 메타데이터 조회는 `private=false`, `visibility=public`을 반환했다. 사용자는 private 저장소라고 설명했고 README에는 “Private”라고 적혀 있다. 서비스가 공개 앱이라는 것과 소스 저장소를 공개한다는 것은 별개다. 현재 GitHub 설정 화면에서 의도한 공개 범위를 확인할 필요가 있다. 이번 감사에서는 설정을 변경하지 않았다. 소스가 공개됐다는 사실만으로 비밀키 유출을 단정하지 않는다. [저장소](https://github.com/teenfo/roxlogy)

### R02 · Web Push endpoint 검증 부족으로 서버 측 임의 요청 가능성

`push_subscriptions.endpoint`는 사용자 소유 행에서 직접 입력 가능한 텍스트이며, `/api/push/resubscribe`는 값의 존재만 검사한다. 발송 함수는 해당 endpoint를 `webpush.sendNotification()`에 전달한다. 저장·발송 경로에서 허용 푸시 공급자·호스트·사설 주소 제한은 확인되지 않았다.

**필요 조건:** 유효한 로그인, 유효한 구독 키 형식, Web Push 설정 및 런타임에서 대상 주소로 나갈 수 있는 네트워크 환경. 실제 내부 주소 접근은 시도하지 않았다. 허용 공급자와 프로토콜 검증, DNS/IP·리다이렉트·egress 통제를 점검해야 한다. 결과 import도 최초 호스트 검사 뒤 `redirect:'follow'`를 사용하므로 후속 목적지 검증을 함께 확인한다.

근거: [resubscribe:26](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/app/api/push/resubscribe/route.ts#L26), [구독 RLS:23](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260716000001_push_notifications.sql#L23), [push-send](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/push-send/index.ts), [결과 import](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/app/api/races/import/route.ts). 검토 기준: [OWASP SSRF 방어 지침](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### R03 · Android WebView 브리지의 출처 경계가 넓음

`addJavascriptInterface()`로 `RoxNative`를 주입하고, 앱 내부 여부는 기본 호스트와 모든 하위 도메인을 허용한다. 코드의 브리지 제한을 “자기 도메인만”이라고 설명하지만 Android 네이티브 JS 인터페이스는 iframe을 포함한 프레임 노출도 고려해야 한다. 웹 운동 상세에는 외부 YouTube iframe이 있다.

노출된 메서드는 알림 활성/비활성·워치 화면 열기 등이며, 확인한 코드에서 토큰을 반환하는 메서드는 없다. 따라서 계정 탈취로 단정하지 않는다. 신뢰한 origin만 받는 메시지 방식, scheme·host·port의 정확한 검증과 외부 프레임 정책을 기기에서 검증할 필요가 있다.

근거: [WebAppScreen](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/android/app/src/main/kotlin/app/roxlogy/android/web/WebAppScreen.kt), [WebConfig](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/android/app/src/main/kotlin/app/roxlogy/android/web/WebConfig.kt), [NativeBridge](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/android/app/src/main/kotlin/app/roxlogy/android/push/NativeBridge.kt), [외부 iframe](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/web/app/(app)/exercises/[id]/page.tsx#L136). 검토 기준: [Android WebView native bridge 보안 문서](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).

### R04 · 세션 업로드 크기 제한이 전체 본문 읽기 이후에 적용됨

`ingest-session`은 `req.text()`로 전체 본문을 읽은 뒤 2MB 초과 여부를 검사한다. 응답 계약의 크기 제한은 있지만 애플리케이션의 메모리 사용을 제한하는 스트리밍 상한은 아니다. 실제 위험 크기는 Supabase 게이트웨이 요청 상한과 런타임 제한에 달려 있다. 인증 전에 본문을 읽으므로 게이트웨이 보호와 bounded read를 함께 확인한다. 운영 과부하 테스트는 수행하지 않았다. [ingest-session:21](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/functions/ingest-session/index.ts#L21)

### R05 · Android 암호화 토큰 저장소의 백업·복원 정책 확인 필요

토큰은 `EncryptedSharedPreferences`에 저장돼 평문 저장으로 판단하지 않는다. 다만 Manifest는 `allowBackup=true`이며 수집한 트리에 토큰 파일을 제외하는 백업 규칙은 확인되지 않았다. 암호화 데이터와 기기 키의 복원 불일치에 대한 재로그인·복구 동작을 검증해야 한다. 기기·OS별 백업 동작은 확인하지 않았다.

근거: [Manifest](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/android/app/src/main/AndroidManifest.xml), [TokenStore](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/android/app/src/main/kotlin/app/roxlogy/android/sync/SupabaseConfig.kt). 검토 기준: [Android Auto Backup](https://developer.android.com/identity/data/autobackup).

## 5. 확인된 긍정적 통제와 과거 수정 사항

- 사용자 데이터에 RLS와 소유권 검사를 적용하고, MCP 운영 도구에서 크루 역할을 확인하는 구조가 존재한다. 다만 실제 운영 권한은 별도 확인이 필요하다. RLS와 테이블 접근 권한은 함께 검증해야 한다. [Supabase RLS 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)
- 특권 프로필 컬럼 변경을 막는 가드가 있다. 과거 `is_admin` 직접 변경 문제를 현재 미수정 취약점으로 다시 보고하지 않았다. 이 가드와 UI 재발급의 충돌은 A01로 따로 다뤘다.
- 위험 내부 함수의 클라이언트 실행 권한 회수, PUBLIC EXECUTE를 제거하는 이벤트 트리거가 마이그레이션에 있다. 과거 `enqueue_notification`·`_mcp_insert_workouts` 노출은 후속 수정까지 추적했으며 현재의 미수정 노출로 집계하지 않았다. [권한 회수](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260830000012_audit_security_and_rpc.sql), [신규 함수 잠금](https://github.com/teenfo/roxlogy/blob/3ab32b66b36473872f1a637e8bb69086a46c0077/supabase/migrations/20260830000024_lock_public_execute.sql). 함수 권한의 별도 검증 기준: [Supabase 함수 보안](https://supabase.com/docs/guides/database/functions).
- 세션 수신 RPC에는 사용자 소유권 조건, `client_updated_at` 기반 LWW, soft-delete 보존과 트랜잭션 단위 처리가 있다. 모든 세션 변경이 무조건 안전하다는 보증은 아니다.
- 캐시는 공개 참조 데이터용 anon 클라이언트와 요청 내 React cache를 구분한다. 표본 검토에서 사용자별 데이터를 전역 캐시에 넣는 경로는 발견하지 않았다.
- 네이티브 로그인 토큰은 URL fragment로 전달하고 웹에서 즉시 제거한다. Android 토큰 저장에는 암호화 저장소를 사용한다.
- 대회 동기화에는 참조 중인 행 보호와 삭제 10건 상한이 있다. A08은 이 보호를 인정한 상태에서 남는 삭제 범위를 지적한다.
- 검토 텍스트에서 비밀키 PEM 헤더·GitHub PAT·신형 Supabase secret 키의 제한된 패턴 검색은 일치 0건이었다. 이는 모든 비밀정보 형식이나 과거 커밋까지 검사한 결과가 아니다. 공개용 anon 키·Firebase 클라이언트 설정은 이름만으로 비밀키 유출로 분류하지 않았다.

## 6. 모의 검증 결과

| 검증 | 외부 대체 조건 | 실제 관찰 | 관련 항목 |
| --- | --- | --- | --- |
| 비로그인 ICS | Auth claims 없음, NextResponse 어댑터 | matcher=true, 로그인 URL로 307 | A04 |
| 푸시 503 | 가짜 구독과 발송 모듈 오류 | 첫 실행 sent=0/failed=1, 다음 실행 dispatched=0 | A05 |
| 지표 DB 오류 | upsert가 `{error}` 반환 | 세션 done, metrics=1, failed=0 | A06 |
| AI 프로그램 하위 저장 오류 | 상위 INSERT 성공, 일차 INSERT 실패 | 프로그램 ID 반환 | A06 |

4개 검증 모두 보고한 실패 동작을 재현했다. “서비스 테스트 통과”를 뜻하는 결과가 아니다. 원본 함수의 제어 흐름을 검증한 것이며, 실제 DB 장애나 푸시 서비스를 호출하지 않았다.

SQL 권한·토큰 재발급은 실행하지 않고 후속 마이그레이션까지 정적으로 추적했다. 실제 두 DB 세션의 경쟁 상태, BLE 연결, 백업 복원, 외부 egress/SSRF는 검증하지 않았다.

## 7. 운영 기록 해석

최근 조회한 GitHub Actions 실행 8건은 모두 `sync-race-events` 성공이었다. 최신 실행은 2026-09-10 18:11:59 UTC, 한국 시간 2026-09-11 03:11:59에 시작했다. 이는 워크플로 프로세스가 성공 종료했다는 근거이며 데이터 완전성이나 웹 전체 정상 상태를 증명하지 않는다. [최신 실행](https://github.com/teenfo/roxlogy/actions/runs/34512842051)

최근 커밋은 대회 일정 갱신과 중복/덮어쓰기 수정에 집중돼 있다. 프로젝트 지침에도 DB 반환 구조와 웹 배포 시점 차이로 인한 장애 이력이 기재돼 있다. 이 내용은 저장소 문서의 기록이며 운영 로그로 별도 재확인하지 않았다.

## 8. 권고 실행 순서와 재감사 기준

아래는 권고안이며 이번에 실행한 수정 작업이 아니다.

| 순서 | 대상 | 권고 작업 | 재감사 증거 |
| --- | --- | --- | --- |
| 1 | A01·A02·R01 | 토큰 회수·정지 계정 차단 복구, 공개 범위 의도 확인 | 새/구 토큰·기존 JWT 허용/거부 결과, 설정 확인 |
| 2 | A06·A07 | 원자적 저장, 오류 검사, 작업 클레임·멱등 처리 | DB 실패·동시 실행 후 데이터와 완료 상태 비교 |
| 3 | A08 | 시즌별 완전성 추적과 삭제 보호 | 부분 응답·시즌 전환 모의 데이터의 삭제 없음 |
| 4 | A04·A05 | 구독 인증 경로 분리, 푸시 재시도 | 비로그인 ICS와 전송 실패 후 복구 결과 |
| 5 | A03·A09 | 권한 안내·scope 정합성, 회귀 검증 자동화 | 읽기 토큰의 쓰기 거부 및 CI 실행 결과 |
| 6 | R02~R05 | egress·WebView·요청 상한·백업 검증 | 격리 환경의 주소 제한·기기 복원·부하 상한 결과 |

운영 적합성 재판정에는 저장소 수정만이 아니라 **적용된 마이그레이션/ACL, 실제 배포 커밋, 권한별 부정 테스트, 실패 후 복구 증거**가 필요하다. 이번 감사 산출물은 그 검증을 위한 우선순위와 근거이며, 프로젝트에 대한 변경 명령이나 배포 승인으로 사용하지 않는다.

## 9. 감사 수행 기록

- GitHub 접근: 저장소·파일·커밋·Actions 메타데이터 GET만 사용.
- 프로젝트 변경: 커밋·푸시·PR·설정 변경·배포·마이그레이션 실행 없음.
- 운영 데이터: 조회·수정 없음. 실제 푸시·AI 생성·유료 결과 API 호출 없음.
- 생성물: 본 보고서. 감사용 소스 사본과 모의 검증 자료는 원본 저장소 외부의 임시 작업 공간에서만 사용.
- 판단 기준: 저장소 코드와 문서, Supabase·Android·OWASP 공식 문서.
