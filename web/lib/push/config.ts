// VAPID 공개키 — 브라우저에 전달되는 공개 식별자라 커밋해도 안전(비밀 아님).
// 개인키(VAPID_PRIVATE_KEY)는 Edge Function 시크릿 전용. NEXT_PUBLIC_ env 로 오버라이드 가능.
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BOPMRaA_TlHsLTyVmigycOeEni5G_r5lgp4ICbdzNHLuGZ3woR8HwRwjuZLuz1ciL7rHSsFh66X8-gclMNmfSY4";
