/* Roxlogy service worker — Web Push 표시 + 클릭 시 해당 화면 열기 */
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_e) { d = {}; }
  const title = d.title || "Roxlogy";
  const options = {
    body: d.body || "",
    icon: "/notif-icon.png",
    badge: "/notif-icon.png",
    data: { url: d.url || "/dashboard" },
    tag: d.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
