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

// android-release 워크플로가 이 버킷에 버전 파일명(roxlogy-*-v{버전}-{빌드}.apk)으로
// 게시하고 latest.json 매니페스트를 갱신한다. 구링크 호환용 roxlogy-*-latest.apk 도 유지.
const STORAGE_PUBLIC =
  "https://vuloxbpfhyqkvgmpmkst.supabase.co/storage/v1/object/public/app-downloads";

export const ANDROID_WEAR_APK_URL: string | null = `${STORAGE_PUBLIC}/roxlogy-wear-latest.apk`;
export const ANDROID_PHONE_APK_URL: string | null = `${STORAGE_PUBLIC}/roxlogy-phone-latest.apk`;

// 가민(.prg)·어메이즈핏(.zab) 사이드로드 패키지 — 각 릴리스 파이프라인이 같은 버킷에 게시.
// 파일이 아직 없으면 다운로드 페이지가 "준비 중"으로 표시한다(storageFileExists).
export const GARMIN_PRG_URL = `${STORAGE_PUBLIC}/roxlogy-garmin-latest.prg`;
export const AMAZFIT_ZAB_URL = `${STORAGE_PUBLIC}/roxlogy-amazfit-latest.zab`;

/** 공개 스토리지에 파일이 실제로 게시됐는지 (서버 컴포넌트용, 5분 캐시). */
export async function storageFileExists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", next: { revalidate: 300 } });
    return r.ok;
  } catch {
    return false;
  }
}

export type AppDownloads = {
  phoneUrl: string | null;
  wearUrl: string | null;
  version: string | null; // 예: "0.2.0"
  build: number | null;   // CI run number
};

/** 최신 릴리스 매니페스트 조회 — 실패 시 -latest.apk 고정 링크로 폴백 (서버 컴포넌트용). */
export async function getAppDownloads(): Promise<AppDownloads> {
  try {
    const r = await fetch(`${STORAGE_PUBLIC}/latest.json`, { next: { revalidate: 300 } });
    if (r.ok) {
      const m = (await r.json()) as {
        version?: string; build?: number; phone?: string; wear?: string;
      };
      if (m?.phone && m?.wear) {
        return {
          phoneUrl: `${STORAGE_PUBLIC}/${m.phone}`,
          wearUrl: `${STORAGE_PUBLIC}/${m.wear}`,
          version: m.version ?? null,
          build: m.build ?? null,
        };
      }
    }
  } catch {
    // 스토리지 일시 불가 — 아래 폴백
  }
  return {
    phoneUrl: ANDROID_PHONE_APK_URL,
    wearUrl: ANDROID_WEAR_APK_URL,
    version: null,
    build: null,
  };
}

export const PLAY_STORE_URL: string | null = null;
export const APP_STORE_URL: string | null = null;
