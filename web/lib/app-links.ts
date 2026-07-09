// 앱 배포 링크.
//
// 사이드로드 APK는 android-release 워크플로가 빌드해 Supabase 공개 스토리지
// (app-downloads 버킷)에 업로드한다 → 아래 공개 URL로 직접 다운로드.
// 최초 릴리스 실행(CI 시크릿 SUPABASE_SERVICE_ROLE_KEY 필요) 전에는 파일이 없어
// 링크가 404일 수 있다.
//
// 플레이스토어/앱스토어 등록(컷오버 이후)이 되면 PLAY_STORE_URL/APP_STORE_URL을
// 채운다 — 그러면 다운로드 페이지가 배지 링크로 전환된다.
// iOS는 직접 설치가 불가하므로 App Store 등록 전에는 노출하지 않는다.

// 최초 릴리스(android-release 워크플로)가 이 버킷에 APK를 올리기 전에는 파일이 없어
// 링크가 404가 된다. 그래서 게시 전까지는 null로 두어 "곧 제공" 상태로 표시한다.
// 게시 후 아래 URL로 바꾸면 다운로드가 활성화된다:
//   `${STORAGE_PUBLIC}/roxlogy-wear-latest.apk` / `${STORAGE_PUBLIC}/roxlogy-phone-latest.apk`
const STORAGE_PUBLIC =
  "https://vuloxbpfhyqkvgmpmkst.supabase.co/storage/v1/object/public/app-downloads";
void STORAGE_PUBLIC;

export const ANDROID_WEAR_APK_URL: string | null = null;
export const ANDROID_PHONE_APK_URL: string | null = null;

export const PLAY_STORE_URL: string | null = null;
export const APP_STORE_URL: string | null = null;
