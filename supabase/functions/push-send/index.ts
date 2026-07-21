// push-send — 종류-무관 푸시 발송기 (Phase 1)
// 입력: { user_id, type_key, title, body, url?, data? }
// - service_role 로 호출: 임의 user_id 에게 발송(트리거/크론용).
// - 일반 로그인 사용자로 호출: 본인에게만 발송(설정 화면의 "테스트 알림").
// 옵트아웃(notification_prefs) 존중 → 구독(push_subscriptions) 팬아웃(web-push/FCM)
// → 죽은 구독 정리 → notifications 아웃박스 기록.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@roxlogy.com";
const FCM_SA = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";

const canWeb = VAPID_PUBLIC.length > 0 && VAPID_PRIVATE.length > 0;
if (canWeb) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

async function fcmAccessToken(saJson: string): Promise<string | null> {
  try {
    const { GoogleAuth } = await import("npm:google-auth-library@9");
    const auth = new GoogleAuth({
      credentials: JSON.parse(saJson),
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    const t = await client.getAccessToken();
    return t.token ?? null;
  } catch (_e) {
    return null;
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

Deno.serve(async (req) => {
  // CORS 프리플라이트 — 브라우저가 POST 전에 보냄
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  let payloadIn: Record<string, unknown>;
  try { payloadIn = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const admin = createClient(URL_, SERVICE);
  const isService = token === SERVICE;

  // 대상 사용자 결정: 서버는 임의, 사용자는 본인만(자기 테스트)
  let targetUser = String(payloadIn.user_id ?? "");
  if (!isService) {
    const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    targetUser = user.id;
  }
  if (!targetUser) return json({ error: "user_id" }, 400);

  const type_key = String(payloadIn.type_key ?? "test");
  const title = String(payloadIn.title ?? "Roxlogy");
  const body = payloadIn.body != null ? String(payloadIn.body) : null;
  const url = payloadIn.url != null ? String(payloadIn.url) : "/dashboard";
  const data = (payloadIn.data as Record<string, unknown>) ?? {};

  // 옵트아웃 존중 (test 는 항상 발송)
  if (type_key !== "test") {
    const { data: typeRow } = await admin.from("notification_types")
      .select("default_enabled").eq("key", type_key).maybeSingle();
    const { data: pref } = await admin.from("notification_prefs")
      .select("enabled").eq("user_id", targetUser).eq("type_key", type_key).maybeSingle();
    const enabled = pref ? pref.enabled : (typeRow?.default_enabled ?? true);
    if (!enabled) return json({ skipped: "opted_out" });
  }

  // 아웃박스 기록
  const { data: notif } = await admin.from("notifications")
    .insert({ user_id: targetUser, type_key, title, body, url, data })
    .select("id").single();

  const { data: subs } = await admin.from("push_subscriptions")
    .select("*").eq("user_id", targetUser).eq("disabled", false);

  const msg = JSON.stringify({ title, body, url, data });
  const fcmToken = FCM_SA ? await fcmAccessToken(FCM_SA) : null;
  const fcmProject = FCM_SA ? (() => { try { return JSON.parse(FCM_SA).project_id; } catch { return null; } })() : null;

  let sent = 0, pruned = 0;
  for (const s of subs ?? []) {
    try {
      if (s.platform === "web" && s.endpoint && canWeb) {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          msg,
        );
        sent++;
      } else if (s.platform === "android" && s.fcm_token && fcmToken && fcmProject) {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmProject}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${fcmToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token: s.fcm_token,
              notification: { title, body: body ?? "" },
              data: { url, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) },
              android: { priority: "high" },
            },
          }),
        });
        if (r.status === 404 || r.status === 400) { await admin.from("push_subscriptions").delete().eq("id", s.id); pruned++; }
        else if (r.ok) sent++;
      }
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); pruned++; }
    }
  }

  if (notif?.id) await admin.from("notifications").update({ sent_at: new Date().toISOString() }).eq("id", notif.id);
  return json({ ok: true, sent, pruned, subs: subs?.length ?? 0 });
});
