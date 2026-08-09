import { BaseSideService } from "@zeppos/zml/base-side";

// 폰(Zepp 앱) 측 서비스 — 워치가 보낸 세션을 ingest-session 으로 업로드한다.
// anon 키(공개, RLS 보호) + 사용자 액세스 토큰(설정에서 입력). service role 금지.
const INGEST_URL =
  "https://vuloxbpfhyqkvgmpmkst.supabase.co/functions/v1/ingest-session";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bG94YnBmaHlxa3ZnbXBta3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTc0NzgsImV4cCI6MjA5ODc5MzQ3OH0." +
  "WhmfRIZWBS88_Rf-e_p7tMpOLKEX9kKxC67KVrLZGjs";

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      if (req.method !== "UPLOAD") {
        res(null, { ok: false, reason: "unknown method" });
        return;
      }
      const token = settings.settingsStorage.getItem("token") || "";
      if (!token) {
        res(null, { ok: false, reason: "no token" });
        return;
      }
      fetch({
        url: INGEST_URL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(req.body),
      })
        .then((r) => {
          const ok = r.status >= 200 && r.status < 300;
          res(null, { ok, status: r.status });
        })
        .catch(() => res(null, { ok: false, reason: "network" }));
    },

    onRun() {},
    onDestroy() {},
  }),
);
