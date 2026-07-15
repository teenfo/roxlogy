# 푸시 알림 계획서 — PWA(Web Push) + APK(FCM), 확장 가능한 코어

## Context (목표)
- 폰 앱(네이티브 WebView 하이브리드)과 웹 PWA **양쪽에 푸시 알림** 발송.
- **1차 트리거 2종**: ① 오늘의 WOD 리마인더(스케줄), ② 새 팔로워 알림(이벤트).
- **확장성 최우선**: 알림 "종류" 추가가 쉬워야 함 → 종류-무관 발송 파이프라인 + 종류별 프로듀서만 추가.

## 현재 상태 (조사)
- 푸시 인프라 전무: 서비스워커·web-push·FCM·구독 테이블 없음.
- 폰 앱 = WebView 셸(**Android WebView는 백그라운드 Web Push 미지원 → 네이티브 FCM 필수**).
- `follows(follower_id, followee_id, created_at)` 존재 → 팔로우 이벤트 소스.
- 프로그램/일정(`program_enrollments`·`program_days`·`workout_templates`)로 "오늘의 WOD" 산출 가능.
- `profiles`에 **타임존/리마인더 시간 없음** → 리마인더용으로 추가 필요.
- Edge Function은 `ingest-session`만. pg_cron/pg_net 미사용.

## 핵심 설계 — 종류-무관 발송 파이프라인 (확장성의 축)

### 데이터 모델 (Supabase, 전부 RLS)
- **`push_subscriptions`**: `id, user_id, platform('web'|'android'), endpoint, p256dh, auth, fcm_token, ua, created_at, last_seen, disabled`
  - web 구독 = endpoint/p256dh/auth, android = fcm_token. 사용자당 다기기 다중 행.
  - RLS: 본인 행만 CRUD. 발송기는 서버(Edge, service role)로 대상 사용자의 구독 조회.
- **`notification_types`**(시드): `key, description, default_enabled` — 종류 카탈로그. **새 종류 = 행 1개 추가**.
- **`notification_prefs`**: `user_id, type_key, enabled` — 종류별 옵트인/아웃. 없으면 `notification_types.default_enabled` 적용.
- **`notifications`**(아웃박스 겸 인앱 인박스): `id, user_id, type_key, title, body, url, data jsonb, created_at, sent_at, read_at`
  - 모든 발송을 기록 → 인앱 알림함·재발송·디버그. 새 종류도 같은 테이블에 `type_key`만 다르게 기록.

### 발송기 — Edge Function `push-send` (종류 무관)
입력: `{ user_id, type_key, title, body, url, data }`. 처리:
1. `notification_prefs`(+`notification_types` 기본값)로 **옵트아웃 존중**.
2. 대상 사용자 `push_subscriptions` 로드.
3. **팬아웃**: web → web-push(VAPID), android → FCM HTTP v1. (payload 계약 통일)
4. **죽은 구독 정리**: web 410/404·FCM UNREGISTERED → 해당 행 삭제.
5. `notifications`에 로그(`sent_at`).
→ 이 함수는 **어떤 종류든 동일하게 처리**. 새 종류는 이 함수를 호출만 하면 됨.

### 페이로드 계약 (모든 종류 공통·안정)
`{ type_key, title, body, url, data? }` — `url`은 탭 시 이동 경로(예: `/u/<id>`, `/schedule`).

## 트리거(프로듀서) — 종류별로 붙는 유일한 부분

### ① 새 팔로워 (이벤트 기반)
- `follows` **AFTER INSERT** 트리거 → `pg_net`으로 `push-send` 호출(또는 Supabase Database Webhook).
- 대상 = `followee_id`, payload = 팔로워 `display_name`, `url=/u/<follower_id>`, `type_key='new_follower'`.

### ② 오늘의 WOD 리마인더 (스케줄 기반)
- `profiles`(또는 `notification_prefs`)에 **`timezone`, `wod_reminder_time`** 추가.
- **pg_cron** 매시 정각 실행 → 각 사용자 로컬시각이 리마인더 시각과 일치하고, 활성 프로그램의 **오늘 워크아웃이 있으며(휴식일 아님)**, 오늘 미발송인 사용자 선별 → `push-send`(`type_key='wod_reminder'`, `url=/schedule`).
- "오늘의 WOD" 판정은 웹 대시보드/`schedule` 로직 재사용(같은 enrollment·program_days 계산).

> 확장 예시(추후): 레이스 D-day(cron), 새 피드(follows 팔로잉 기반 이벤트), 리더보드 변동(cron) — **각각 프로듀서 1개 + `notification_types` 행 1개**만 추가, 발송기·구독·클라이언트는 그대로.

## 클라이언트

### 웹 PWA (Web Push)
- **서비스워커** `web/public/sw.js`: `push`(알림 표시), `notificationclick`(→ `url` 열기).
- 등록 + 권한 UI(`/settings/profile` 토글): `Notification.requestPermission()` → `pushManager.subscribe({applicationServerKey: VAPID_PUBLIC})` → 구독을 `push_subscriptions`에 insert(PostgREST + RLS).
- `VAPID_PUBLIC`은 `NEXT_PUBLIC_*`(공개 무방). manifest는 이미 존재.
- ⚠️ iOS는 16.4+ **홈 화면 설치형 PWA**에서만 동작(안내 노출).

### 네이티브 Android (FCM)
- Firebase: `google-services.json`(app.roxlogy.android) + `com.google.gms.google-services` 플러그인 + `firebase-messaging` 의존성.
- `RoxMessagingService : FirebaseMessagingService`: `onNewToken`→토큰 업로드(로그인 토큰으로 `push_subscriptions` upsert), `onMessageReceived`→알림 채널로 표시.
- **POST_NOTIFICATIONS** 런타임 권한(Android 13+).
- 탭 딥링크: intent extra `url` → `MainActivity`가 `WebAppScreen`을 `WEB_APP_URL + url`로 로드(세션 이미 주입).
- 로그인 후 FCM 토큰 확보 → 업로드. 로그아웃 시 토큰 행 삭제.

## 보안 (엄수)
- **VAPID 개인키 · FCM 서비스계정 JSON = 서버 전용 시크릿**(Edge Function secrets). 클라이언트·커밋 금지(service role과 동급).
- `google-services.json`·`VAPID_PUBLIC` = 공개 식별자, 커밋 무방.
- `push_subscriptions` RLS: 본인만. 발송기는 Edge 내부 service role로 대상 조회(서버 컨텍스트).
- 옵트아웃·권한상태 항상 존중. 죽은 토큰 즉시 정리.

## 롤아웃 단계
1. **인프라 코어**: 마이그레이션(4테이블+RLS+시드), Edge `push-send`(web-push+FCM), VAPID 생성·시크릿 설정, **수동 테스트 발송** 경로. + 웹 구독/네이티브 토큰 등록.
2. **트리거 ①**: `follows` AFTER INSERT → `push-send`(new_follower). pg_net 활성.
3. **트리거 ②**: `profiles`에 timezone/reminder_time, pg_cron 스캔 → `push-send`(wod_reminder).
4. **설정 UI**: 종류별 토글(`notification_prefs`) + 문서화.

## 사용자(콘솔) 선행 작업 — 제가 만들 수 없는 것
- **Firebase 프로젝트**: 기존 GCP 프로젝트(`gen-lang-client-0855612550`)에 Firebase 추가 또는 신규 → Android 앱 `app.roxlogy.android` 등록 → `google-services.json` 다운로드 → **서비스계정 키(HTTP v1)** 발급.
- Supabase: `pg_cron`·`pg_net` 확장 활성(대시보드/SQL), Edge Function 시크릿(`VAPID_PRIVATE`, `FCM_SERVICE_ACCOUNT`) 등록.
- VAPID 키쌍은 제가 생성해 공개키는 클라이언트, 개인키는 시크릿으로 안내.

## 검증
- 웹: Android Chrome 구독 → 테스트 발송 수신, 탭 시 `url` 이동. iOS 설치형 PWA(사용자 기기).
- 네이티브: APK 설치 → 권한 허용 → 토큰 업로드 → 테스트 발송 수신 + 탭 시 해당 화면.
- ① B가 A 팔로우 → A 수신. ② 리마인더 시각 도달 + 오늘 WOD 있는 사용자 수신.
- 죽은 토큰: 구독 해제 → 410/UNREGISTERED → 행 삭제 확인.

## 리스크
- iOS PWA 푸시는 설치형 한정 → UI 안내로 완화.
- 타임존/리마인더 데이터 신규 → 기본값(예: Asia/Seoul, 07:00)·온보딩 안내.
- FCM/web-push 시크릿 관리 → Edge secrets, 절대 커밋 금지.
- cron 중복 발송 → `notifications`에 당일 발송기록으로 idempotency 가드.
