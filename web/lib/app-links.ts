// 앱 배포 링크. 스토어 등록·APK 게시 전에는 모두 null → 다운로드 페이지가
// "곧 제공" 상태로 렌더된다.
//
// 게시 방법:
//  - 직접 APK: web/public/downloads/ 에 파일을 두고
//    ANDROID_APK_URL = "/downloads/roxlogy-<버전>.apk" 로 설정 (roxlogy.com에서 직접 다운로드)
//    또는 외부 URL(GitHub Releases 등)을 그대로 지정.
//  - 스토어 등록 후: PLAY_STORE_URL / APP_STORE_URL 을 채우면 배지 링크로 즉시 전환.
//
// iOS는 직접 설치가 불가하므로 다운로드 페이지에 노출하지 않는다(App Store 등록 후 배지만).

export const ANDROID_APK_URL: string | null = null;
export const PLAY_STORE_URL: string | null = null;
export const APP_STORE_URL: string | null = null;
