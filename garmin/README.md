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

1. [Connect IQ SDK](https://developer.garmin.com/connect-iq/sdk/) 설치 후 SDK의 `bin`을 PATH에 추가
   (`monkeyc` 실행 가능해야 함). VS Code + "Monkey C" 확장도 권장.
2. **한 방에 빌드**: `cd garmin && ./build.sh fenix7`
   - 최초 실행 시 개발자 키(`developer_key.der`)를 자동 생성한다(커밋 금지 — `.gitignore` 처리).
   - 결과: `roxlogy-fenix7.prg`. 다른 기기는 `./build.sh <device>` (manifest의 `<iq:product>` 참고).
   - 수동으로는: `monkeyc -d fenix7 -f monkey.jungle -o roxlogy.prg -y developer_key.der`
3. **사이드로드**: VS Code "Build for Device"로 실행하거나, `.prg`를 워치 `GARMIN/APPS`에 복사.
4. **토큰**: Garmin Connect 모바일 앱 → Roxlogy 앱 설정 → Supabase access token(테스트 계정) 입력.
5. 시뮬 기록 → 완료 → 웹 `/sessions`에서 소스=워치 세션 확인.

> 이 저장소의 `garmin-ci`는 **구조 검증만** 한다(SDK 없이 monkeyc 컴파일 불가). 위 SDK 빌드에서
> Monkey C API 시그니처 오류가 나오면(특히 `Pm5Ble`의 BLE·`SimView`의 ActivityRecording) 로그를
> 공유하면 바로 수정한다. BLE/트레드밀/거리 동작은 **실기기 검증 필수**(시뮬레이터로 실 PM5 불가).

## CI
`.github/workflows/garmin-ci.yml` — 매니페스트/리소스 XML 유효성 + 필수 소스 존재를 검증하는
구조 게이트. 전체 `monkeyc` 컴파일 CI는 개발자 키 시크릿 + SDK 버전 확정 후 추가.

## 구현된 기능 (SDK 컴파일·실기기 검증 필요)
- **러닝 실거리**: `ActivityRecording`(트레드밀) + `Activity.getActivityInfo().elapsedDistance` →
  안쪽 트랙 실측 진행, 1km 자동 랩(수동 탭 폴백). (풋팟은 소스로 자동 반영)
- **목표 diff**(`GoalClient`): goal_plans 조회 → 현재 누적 vs 목표(앞섬 −초록/뒤처짐 +빨강) 표시.
- **PM5 BLE**(`Pm5Ble`): 스키/로잉 스테이션에서 CE060030 + 0031/0032/0033 구독 → 라이브 watts/spm.
- **오프라인 큐**(`Store`/`Uploader`): 업로드 실패·오프라인 시 큐 보관 → 다음 실행 flush 재시도(멱등).

> ⚠️ Monkey C는 이 환경에서 컴파일 검증 불가(구조 게이트만). 위 기능은 **Connect IQ SDK 빌드에서
> API 시그니처 확인·수정이 필요**할 수 있고, BLE/트레드밀/거리는 **실기기 검증**이 필수다.

## 남은 후속
- 에르그 raw 샘플을 업로드 페이로드에 포함(현재 가민은 라이브 표시만).
- OAuth(`makeOAuthRequest`) 승격, 설정 UI 다듬기, 지원 기기 allowlist 확정.
