# Roxlogy 네이티브 앱 (`android/`)

모노레포 Gradle 프로젝트. 확정 스택: Kotlin + Wear Compose(워치) / Compose(폰),
공유 로직은 순수 Kotlin `:shared` 모듈 (iOS 확장 시 KMP 승격).

## 모듈
- **`:shared`** — 순수 Kotlin/JVM. ingest API 계약 모델·직렬화(`docs/API_CONTRACT.md`
  정합), 스테이션 UUID(웹 시드 일치), 이후 PM5 BLE 프레임 파서(N1). **Android SDK 없이
  로컬/CI 유닛테스트 가능.**
- **`:wear`** — Wear OS 앱. PM5 BLE 수집(N2), 레이스 시뮬 기록, Data Layer 전송.
  패키지 `app.roxlogy.wear`.
- **`:app`** — Android 폰. Data Layer 수신 → `ingest-session` 업로드. 패키지 `app.roxlogy.android`.

## 로컬 개발
```bash
cd android
./gradlew :shared:test                 # 공유 로직 유닛테스트 (SDK 불필요)
./gradlew :wear:assembleDebug          # 워치 debug APK (Android SDK 필요)
./gradlew :app:assembleDebug           # 폰 debug APK
```
Android Studio로 `android/`를 열면 자동 동기화된다. `local.properties`에 `sdk.dir`가
없으면 Studio가 생성한다(커밋 금지 — .gitignore 처리됨).

## CI
`.github/workflows/android.yml` — 푸시 시 `:shared` 테스트 + 워치/폰 debug APK 빌드 →
아티팩트 업로드. (N6a에서 release 서명 APK를 GitHub Releases로 게시 → 웹 다운로드
페이지 `web/lib/app-links.ts`의 `ANDROID_APK_URL`로 연결.)

## 보안 규칙 (엄수 — 루트 CLAUDE.md)
- Supabase **service role 키는 클라이언트에 절대 금지.** 폰은 anon 키 + 사용자 JWT로만
  `ingest-session`(Edge Function)을 호출한다.
- "HYROX" 상표는 앱/패키지명에 사용하지 않는다(설명·호환성 표기만 허용).

## 실기 검증 (BLE)
PM5 BLE 실시간 흐름은 물리 기기(Wear OS 워치 + Concept2 PM5)로만 검증 가능.
파싱 로직 자체(N1)는 캡처 바이트 픽스처로 CI 유닛테스트가 커버한다.
