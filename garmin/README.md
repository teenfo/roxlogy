# Roxlogy — Garmin (Connect IQ) 워치 앱

하이록스 **시뮬레이션 레코더**. 러닝 8×1km + 스테이션 8 + 록스존을 24슬롯으로 기록하고
`ingest-session`으로 업로드한다. 배경 = 로고 두 링(바깥 옐로 8세그먼트=스테이션 완료,
안쪽 블루 트랙=1km 러닝 진행). PM5(에르그)는 스키/로잉 스테이션 raw 보강(후속).

## 구조
- `manifest.xml` — Device App(watch-app), CIQ 3.1+, BLE 지원 기기 대상, Communications 권한.
- `source/` — `RoxlogyApp`(진입), `SimModel`(24슬롯 상태기계·스테이션, :shared HyroxSim 이식),
  `SimView`(두 링 Dc 드로잉 + 상태 텍스트), `SimDelegate`(탭/셀렉트로 진행),
  `Uploader`(makeWebRequest → ingest-session, anon 키 + 사용자 JWT).
- `resources/` — 문자열·런처 아이콘·설정(`supabaseAccessToken`).

## 진행 흐름 (탭/셀렉트)
`시작 → RUN i(1km 랩) → ROXZONE(스테이션 이동) → STATION i(완료) → …(8회)… → 완료 → 전송`

## 인증 (1차)
Garmin Connect 모바일 앱 → 이 앱 설정에서 **Supabase access token**(테스트 계정)을 입력하면
그 토큰으로 업로드한다. 토큰이 없으면 업로드는 스킵(오프라인 큐는 후속).
**service role 키 금지 — anon 키(공개) + 사용자 JWT만.**

## 빌드 / 실행 (개발자 로컬)
Connect IQ는 SDK + 개발자 키가 필요해 로컬(VS Code)에서 빌드한다. 시뮬레이터는 실 PM5/
트레드밀을 재현하지 못하므로 **실기기 검증 필수**.

1. [Connect IQ SDK](https://developer.garmin.com/connect-iq/sdk/) + VS Code "Monkey C" 확장 설치.
2. 개발자 키 생성: `openssl genrsa -out developer_key.pem 4096 && openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt`
3. 이 폴더를 열고 "Build for Device" 또는:
   `monkeyc -d fenix7 -f monkey.jungle -o roxlogy.prg -y developer_key.der`
4. 실기기에 사이드로드: `.prg`를 기기 `GARMIN/APPS`에 복사하거나 VS Code에서 실행.
5. 설정에서 테스트 토큰 입력 → 시뮬 기록 → 웹 `/sessions`에서 소스=워치 세션 확인.

## CI
`.github/workflows/garmin-ci.yml` — 매니페스트/리소스 XML 유효성 + 필수 소스 존재를 검증하는
구조 게이트. 전체 `monkeyc` 컴파일 CI는 개발자 키 시크릿 + SDK 버전 확정 후 추가.

## 후속 (계획)
- 러닝 실거리: `Toybox.Activity.getActivityInfo().elapsedDistance`(트레드밀 손목 가속도) +
  풋팟 소스 + 1km 수동 랩 폴백 → 안쪽 트랙 실측 진행.
- 웹 목표 diff: goal_plans 조회 → 현재 누적 vs 목표(앞섬/뒤처짐) 표시.
- PM5 BLE(스키/로잉 raw), 오프라인 큐/재시도, OAuth 승격.
