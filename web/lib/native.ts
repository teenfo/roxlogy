/**
 * 안드로이드 앱(WebView)이 `window.RoxNative` 로 주입하는 브리지.
 *
 * 웹은 이 객체의 존재로 "앱 안"임을 판별한다. UA 스니핑보다 확실하고,
 * 브리지에 없는 메서드는 구버전 앱이라는 뜻이라 기능 단위로 옵셔널이다.
 * (roxlogy.com 페이지만 WebView 에 실리므로 노출 범위는 자기 도메인)
 */
export type RoxNativeBridge = {
  isAvailable?: () => boolean;
  // ---- 푸시 (FCM) — Web Push 미지원 WebView 의 대체 경로
  isConfigured?: () => boolean;
  hasPermission?: () => boolean;
  isEnabled?: () => boolean;
  enable?: () => void;
  disable?: () => void;
  // ---- 셸 네비게이션 — 앱 v0.7+ (네이티브 하단 탭바를 걷어내고 웹 탭바로 통일)
  /** 네이티브 워치 화면(연결·목표 전송·WOD)을 연다 */
  openWatch?: () => void;
};

/** 브라우저에서만. SSR·구버전 앱·일반 브라우저에서는 null. */
export function roxNative(): RoxNativeBridge | null {
  if (typeof window === "undefined") return null;
  const rn = (window as unknown as { RoxNative?: RoxNativeBridge }).RoxNative;
  return rn && rn.isAvailable?.() ? rn : null;
}
