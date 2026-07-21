# FCM 설정 — 안드로이드 앱 푸시 (Phase 1b)

폰 앱(하이브리드)은 WebView라 **Web Push를 못 받는다**(Android WebView 제약). 그래서 네이티브 **FCM(Firebase Cloud Messaging)**으로 앱 푸시를 받는다. 인프라·네이티브 배선은 완료돼 있고, 아래 **Firebase 설정 2가지**만 하면 활성화된다.

> 보안 요약
> - `google-services.json` = **비밀 아님**. API 키가 패키지명·SHA-1로 제한되고 APK에 어차피 포함됨 → 커밋 가능.
> - FCM **서비스계정 JSON** = **비밀**. Supabase Edge 시크릿에만. **커밋·프론트 노출 절대 금지.**

---

## A. Firebase 프로젝트 + Android 앱 등록 → `google-services.json`

1. https://console.firebase.google.com → **프로젝트 추가** (기존 Google Cloud 프로젝트를 연결해도 됨).
2. 좌측 **프로젝트 설정 → 내 앱 → Android 앱 추가**.
   - **Android 패키지 이름**: `app.roxlogy.android`
   - (선택) 디버그 SHA-1 등록 — 푸시에는 불필요, Google 로그인용이면 이미 등록한 값 사용.
3. **`google-services.json` 다운로드.**
4. 앱에 반영 — 둘 중 하나:
   - **간단(권장)**: 파일을 리포의 `android/app/google-services.json` 에 두고 커밋. 빌드 시 자동 적용.
   - **비공개 선호**: 파일을 base64로 인코딩해 GitHub 시크릿 `ROXLOGY_GOOGLE_SERVICES_JSON` 에 등록.
     릴리스 워크플로가 빌드 전에 파일을 복원한다.
     ```bash
     base64 -w0 google-services.json   # 이 출력 전체를 시크릿 값으로
     ```

파일이 없으면 앱은 **정상 빌드**되지만 설정 화면에 "앱 알림은 곧 지원됩니다"로 표시된다(푸시 비활성).

## B. FCM 서비스계정 → Supabase Edge 시크릿 (서버 발송용)

서버(`push-send` Edge Function)가 FCM v1 API로 기기에 보내려면 서비스계정이 필요하다.

1. Firebase **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성** → JSON 다운로드.
2. Supabase 대시보드 → **Edge Functions → Secrets** 에 등록:
   - 이름: `FCM_SERVICE_ACCOUNT`
   - 값: 다운로드한 **JSON 파일 전체 내용**(그대로 붙여넣기).
   - ⚠️ **비밀 — 커밋 금지.** Edge 시크릿에만.

`push-send`는 `FCM_SERVICE_ACCOUNT` 가 있으면 자동으로 FCM v1 액세스 토큰을 발급해 안드로이드 구독으로 팬아웃한다(코드 변경 불필요).

---

## 활성화 확인

1. A로 `google-services.json` 반영 → 앱 재빌드/재설치.
2. B로 `FCM_SERVICE_ACCOUNT` Edge 시크릿 등록.
3. 앱에서 로그인 → **설정 → 알림 → "앱 알림 켜기"** → 권한 허용.
4. 웹(또는 다른 기기)에서 팔로우 등 트리거, 또는 서버에서 `push-send` 호출 → 폰에 알림 도착.

## 동작 요약 (이미 구현됨)

- 네이티브: `RoxMessagingService`(수신·표시), `PushRegistration`(FCM 토큰 → `push_subscriptions` 업서트),
  `RoxNative` JS 브리지(웹 설정 화면의 "앱 알림 켜기"가 네이티브 권한 요청+등록을 호출).
- 서버: `push-send` 가 `push_subscriptions.platform='android'` 구독에 FCM v1으로 발송, 죽은 토큰 정리.
- 알림 탭 → 앱이 해당 화면(`data.url`)으로 진입.
