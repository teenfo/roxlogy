# 전체 화면 리뉴얼 검증 결과

2026-09-20 · `feat/design-gaps-preview-og-onetap`

| 검증 | 결과 |
| --- | --- |
| Next.js production build | 통과 |
| TypeScript | 통과 |
| ESLint | 오류 0, 기존 `lib/session-builder.ts` unused-variable 경고 2 |
| 프로그램 미리보기·OG·One Tap 회귀 테스트 | 22/22 통과 |
| 실제 Next.js HTTP 서버 렌더 | 68개 페이지 + 10개 추가 상태/로케일 = 78/78 통과 |
| 변경 파일 공백·패치 검사 | 통과 |
| 반전 마크 원본 대조 | `brand/roxlogy-mark-inverse.svg`와 바이트 동일 |
| Archivo Black 파일 대조 | 기존 OG 폰트와 바이트 동일, 라이선스 동봉 |
| UI 주요 색상 대비 계산 | 기본 글자 14.79:1, 보조 5.26:1, 강조 글자 5.96:1, 노란 CTA 12.96:1 |
| API·Supabase 클라이언트·Proxy·DB 마이그레이션 | 이번 전체 화면 변경에서 수정 없음 |

HTTP 검증은 브라우저 화면 캡처가 아니다. 실제 production 빌드에 오프라인 Supabase 응답을 연결해 서버 렌더와 표시 상태를 확인했다. 회원 미리보기의 복제/편집 숨김, 회계 비회원 데이터 차단, 정지/크루 로그인/모임 멤버/프로필 필수 안내, 회계 두 탭, en/es 설정 화면을 포함한다.

최초 검증 시 기존 다운로드 페이지가 공개 앱 배포 매니페스트를 외부 Supabase에서 조회하려 해 자동 검토가 검증을 중단했다. 이후 QA 프로세스에 네트워크 가드를 추가했다. 최종 검증은 127.0.0.1:54321 이외의 fetch를 네트워크 호출 전에 거부하며 운영 데이터나 자격 증명을 사용하지 않는다.

원격 브라우저의 로컬 서버 접속은 `ERR_BLOCKED_BY_CLIENT`로 차단되었다. 따라서 데스크톱/모바일의 실제 시각·키보드·터치 확인은 미완료다. 실제 Google/FedCM, 네이티브 Watch/WebView, 푸시 권한, 운영 DB 저장, 여러 기기의 Realtime 계측도 운영 환경에서 추가 확인이 필요하다.

검증 스크립트와 재현 방법은 `ROXLOGY-Screen-Coverage.md`에 있다. 원본 서버 권한·저장·집계·계측 로직을 UI 시안의 가짜 로직으로 교체하지 않았다.
