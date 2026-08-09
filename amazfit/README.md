# Roxlogy — Amazfit (Zepp OS) 워치 앱

하이록스 **시뮬레이션 레코더** 1차. 러닝 8×1km + 스테이션 8 + 록스존을 32슬롯으로
탭 진행 기록하고, 완료 시 폰(Zepp 앱) 측 서비스가 `ingest-session`으로 업로드한다.
가민 버전과 동일한 최소 계약(세그먼트 kind/split_time_ms)·인증 규약을 쓴다.

## 구조 (Zepp OS Mini Program)
- `app.json` — v2 매니페스트. API Level 2.0+, `common` 타깃(designWidth 480).
- `page/index.js` — 워치 UI. idle → running(32슬롯, 탭=다음) → done → 전송.
  심박(@zos/sensor HeartRate) 표시, 화면 유지 60s.
- `app-side/index.js` — 폰 측 업로더. anon 키(공개) + 설정의 사용자 토큰으로 POST.
  **service role 금지.**
- `setting/index.js` — Zepp 앱 내 설정: Supabase access token 입력(가민과 동일 규약).
- 메시징은 공식 `@zeppos/zml` (BasePage.request ↔ BaseSideService.onRequest).

## 빌드 / 배포
- CI: `.github/workflows/amazfit-release.yml` — `zeus build` → `.zab` 를 Supabase
  스토리지(`roxlogy-amazfit-latest.zab`)에 게시. 다운로드 페이지가 이 파일을 가리킨다.
- 로컬: `cd amazfit && npm i && npx zeus build` (zeus 는 docs.zepp.com 접근 필요).
  개발 미리보기: `npx zeus preview` → Zepp 앱 개발자 모드에서 QR 스캔.
- 설치: Zepp 앱 → 프로필 → 설정 → 개발자 모드(About 연타로 활성화) → `.zab` 설치.

## 제약 (1차)
- **PM5 BLE 미지원** — Zepp OS BLE central 제약. 가민과 같이 후속 검토.
- 트레드밀 실거리 미연동 — 1km 는 수동 탭.
- 업로드는 최소 페이로드(kind + split_time_ms) — 심박·erg 확장은 후속.
- `common` 타깃이 일부 구형 기기에서 안 잡히면 기기별 타깃으로 분리 필요.

## 인증
Zepp 앱 → Roxlogy 설정에서 **Supabase access token**(테스트 계정) 입력.
토큰이 없으면 전송 실패로 표시된다(오프라인 큐는 후속).
