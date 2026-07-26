/* Roxlogy service worker — Web Push 표시 + 클릭 시 해당 화면 열기 + 구독 로테이션 복구 */

/* VAPID 공개키 — web/lib/push/config.ts 와 반드시 동일하게 유지(공개 식별자, 비밀 아님). */
const VAPID_PUBLIC_KEY =
  "BOPMRaA_TlHsLTyVmigycOeEni5G_r5lgp4ICbdzNHLuGZ3woR8HwRwjuZLuz1ciL7rHSsFh66X8-gclMNmfSY4";

function urlB64ToUint8(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/* 푸시 페이로드의 url 은 앱 내 상대경로만 신뢰 — 외부 원점으로의 이동 차단. */
function safeUrl(url) {
  try {
    const u = new URL(url || "/dashboard", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  const title = d.title || "Roxlogy";
  const options = {
    body: d.body || "",
    icon: "/notif-icon.png",
    // badge 는 Android 상태바용 알파 마스크 — 컬러 이미지를 주면 흰색 박스로 뭉개진다.
    // 브랜드 마크 흰색 실루엣(96px) 전용 파일 사용.
    badge: "/notif-badge.png",
    data: { url: safeUrl(d.url) },
    tag: d.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          // 비제어 클라이언트는 navigate 가 거부될 수 있음 → 새 창 폴백
          return c.focus().then((wc) =>
            wc && wc.navigate
              ? wc.navigate(url).catch(() => self.clients.openWindow(url))
              : self.clients.openWindow(url),
          );
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

/* 브라우저가 구독을 로테이션하면 조용히 재구독하고 서버에 갱신(쿠키 세션으로 인증). */
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldEndpoint =
    (event.oldSubscription && event.oldSubscription.endpoint) || null;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY),
      })
      .then((sub) => {
        const j = sub.toJSON();
        return fetch("/api/push/resubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            endpoint: j.endpoint,
            p256dh: j.keys && j.keys.p256dh,
            auth: j.keys && j.keys.auth,
            oldEndpoint,
          }),
        });
      })
      .catch(() => {}),
  );
});
