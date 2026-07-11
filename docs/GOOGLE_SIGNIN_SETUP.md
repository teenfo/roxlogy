# Google 로그인 설정 — 폰 앱 (Roxlogy)

폰 앱(`app.roxlogy.android`)의 네이티브 Google 로그인(Credential Manager) 설정 절차.
웹앱은 이미 Supabase Google 프로바이더로 동작 중이며, **네이티브 앱은 같은 웹 클라이언트 ID를 재사용**한다.

## 핵심 개념 (먼저 이해)

- 네이티브 로그인 코드에 들어가는 값은 **웹 클라이언트 ID 하나뿐**이다(`serverClientId`).
  Android 클라이언트 ID·클라이언트 secret은 **코드에 넣지 않는다.**
- **웹 클라이언트 ID는 공개 식별자**(APK에 포함·추출 가능)라 소스에 커밋해도 안전하다. 현재
  `android/app/build.gradle.kts`에 기본값으로 커밋돼 있고, `BuildConfig.GOOGLE_WEB_CLIENT_ID`로 노출된다.
- 네이티브 흐름은 Google이 **설치된 앱의 서명(SHA-1)을 대조**한다. 따라서 "실제로 설치·배포할 APK를
  서명하는 키"의 SHA-1을 Google Cloud **Android 클라이언트**에 등록해야 로그인이 동작한다.
- **클라이언트 secret(`GOCSPX-…`)은 서버(Supabase)에만.** 앱·저장소·CI 아티팩트에 절대 넣지 않는다.

## 현재 구성 (완료됨)

| 항목 | 값/위치 | 상태 |
| --- | --- | --- |
| 웹 클라이언트 ID | `265762211451-6f2krau47k8rnhdstf772c3fpqtkk17c.apps.googleusercontent.com` | 앱에 반영 ✅ |
| 앱 내 주입 | `SupabaseConfig.GOOGLE_WEB_CLIENT_ID` ← `BuildConfig` ← gradle 기본값/`ROXLOGY_GOOGLE_WEB_CLIENT_ID` | ✅ |
| Supabase Google 프로바이더 | Auth → Providers → Google (웹 ID + secret) | ✅ (웹 로그인 사용 중) |
| Android OAuth 클라이언트 | Google Cloud, 프로젝트 `gen-lang-client-0855612550`, 패키지 `app.roxlogy.android` | ✅ |

## Google Cloud 설정

같은 프로젝트(`gen-lang-client-0855612550`)에 **웹**과 **Android** 두 클라이언트가 있어야 한다.

### 웹 클라이언트 (이미 존재 — "Roxlogy Supabase")
- 유형: 웹 애플리케이션
- Authorized redirect URI: `https://vuloxbpfhyqkvgmpmkst.supabase.co/auth/v1/callback`
- 이 Client ID + Secret을 Supabase Google 프로바이더에 등록(웹 로그인용).

### Android 클라이언트 (이미 존재 — "Roxlogy-Android")
- APIs & Services → Credentials → + Create Credentials → OAuth client ID → **Android**
- Name: `Roxlogy-Android`
- Package name: `app.roxlogy.android`
- SHA-1 certificate fingerprint: **앱을 서명하는 키의 SHA-1** (아래 참조)
- 여기서 나오는 Android 클라이언트 ID는 **코드에 넣지 않는다.**

> 한 Android 클라이언트에 SHA-1을 **여러 개** 추가할 수 있다. debug 키(개발 테스트)와 release 키
> (배포 APK)를 모두 등록해두면 두 빌드 다 로그인이 동작한다.

## SHA-1 확인 방법

### 개발용(debug) — Android Studio로 직접 빌드·설치한 앱
```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1
```

### 배포용(release) — 다운로드 페이지 APK
아래에서 만드는 **고정 release keystore**의 지문:
```bash
keytool -list -v -keystore roxlogy-release.jks -alias roxlogy | grep SHA1
```
또는 서명된 APK에서 직접:
```bash
keytool -printcert -jarfile app-release.apk | grep -Ei "SHA1|SHA256"
```
릴리스 워크플로도 빌드 후 이 값을 로그에 출력한다("Print phone APK signing SHA-1" 스텝).

## 배포 APK 서명 배선 (release keystore)

다운로드 페이지의 APK는 CI(`.github/workflows/android-release.yml`)가 빌드한다. Google 로그인이
배포 APK에서도 동작하려면 **항상 같은 release 키로 서명**되어야 한다.

### 1) 고정 release keystore 생성 (최초 1회, 안전 보관)
```bash
keytool -genkeypair -v -keystore roxlogy-release.jks -alias roxlogy \
  -keyalg RSA -keysize 2048 -validity 10000
```
> ⚠️ 이 `.jks` 파일과 비밀번호는 **절대 분실 금지** — 잃으면 같은 앱으로 업데이트 배포 불가.
> **저장소에 커밋 금지.**

### 2) keystore를 base64로 인코딩
```bash
base64 -w0 roxlogy-release.jks > roxlogy-release.jks.b64   # Linux
# macOS: base64 -i roxlogy-release.jks -o roxlogy-release.jks.b64
```

### 3) GitHub 레포 시크릿 등록
Settings → Secrets and variables → Actions → New repository secret:

| 시크릿 이름 | 값 |
| --- | --- |
| `ROXLOGY_KEYSTORE_BASE64` | 2)의 base64 문자열 전체 |
| `ROXLOGY_KEYSTORE_PASSWORD` | keystore 비밀번호(store password) |
| `ROXLOGY_KEY_ALIAS` | `roxlogy` (키 별칭) |
| `ROXLOGY_KEY_PASSWORD` | 키 비밀번호(key password) |

> `ROXLOGY_GOOGLE_WEB_CLIENT_ID`는 소스에 기본값이 있어 **선택**이다(다른 프로젝트로 바꿀 때만 등록).

### 4) release keystore의 SHA-1을 Android 클라이언트에 추가 등록
1)에서 만든 keystore의 SHA-1(위 "배포용" 명령)을 Google Cloud "Roxlogy-Android" 클라이언트에
**SHA-1 지문 추가**로 등록한다.

### 5) 릴리스 실행
`v*` 태그 push 또는 Actions에서 `android-release` 수동 실행. 워크플로가:
1. base64 시크릿 → keystore 파일 복원
2. `:app`·`:wear`를 그 키로 서명해 assembleRelease
3. 서명 SHA-1을 로그에 출력
4. Supabase 스토리지 `app-downloads`에 업로드

keystore 시크릿이 없으면 debug 서명으로 폴백되고 경고를 남긴다(이 경우 Google 로그인은 실패).

## (선택) Play 스토어 배포 시
Google Play 앱 서명을 쓰면 Google이 최종 서명 키를 관리한다. Play Console → 앱 → 설정 → 앱 서명에서
**"앱 서명 키 인증서"의 SHA-1**을 확인해 같은 Android 클라이언트에 **추가로** 등록해야 한다.

## Supabase 프로바이더
Authentication → Providers → Google:
- Client ID: **웹** 클라이언트 ID
- Client Secret: 웹 클라이언트 secret(`GOCSPX-…`)
- (Authorized Client IDs 칸이 있으면 웹 클라이언트 ID를 함께 추가)

> 네이티브 앱이 발급받는 ID 토큰의 audience는 웹 클라이언트 ID이며, Supabase는 이 값을 기준으로
> `id_token` grant를 검증한다.

## 보안 규칙 (엄수)
- release keystore(`.jks`)와 그 비밀번호, 클라이언트 secret(`GOCSPX-…`)은 **커밋·아티팩트·클라이언트 금지**.
- Supabase **service role 키**는 서버/CI 시크릿 전용(클라이언트 노출 금지).
- 웹 클라이언트 ID·anon 키는 공개 식별자라 커밋 무방.

## 트러블슈팅
- **버튼은 뜨는데 로그인 실패** → 설치된 앱의 서명 SHA-1이 Android 클라이언트에 등록돼 있는지 확인
  (debug로 설치했는데 release SHA-1만 등록된 경우가 흔함).
- **`10:` 개발자 오류(DEVELOPER_ERROR)** → 패키지명 불일치, SHA-1 미등록, 또는 웹/Android 클라이언트가
  서로 다른 프로젝트에 있음.
- **`id_token` 검증 실패** → Supabase Google 프로바이더의 Client ID가 앱이 쓰는 웹 클라이언트 ID와 동일한지 확인.
