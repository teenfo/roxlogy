// push-send — 종류-무관 푸시 발송기 (즉시 발송 API: 테스트·직접 호출용)
// 입력: { user_id, type_key, title, body, url?, data? }
// - service_role 로 호출: 임의 user_id 에게 발송(서버 내부용).
// - 일반 로그인 사용자로 호출: 본인에게만 발송(설정 화면의 "테스트 알림").
// 큐 기반 발송(팔로워·WOD 등)은 프로듀서가 notifications 에 삽입 → push-dispatch 가 처리.
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

// 잘못된 키로 콜드스타트 전체가 죽지 않게 try/catch — 실패 시 웹 발송만 비활성.
let canWeb = VAPID_PUBLIC.length > 0 && VAPID_PRIVATE.length > 0;
if (canWeb) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    console.error("VAPID 키 형식 오류 — 웹 발송 비활성:", e);
    canWeb = false;
  }
}

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
  } catch (e) {
    console.error("FCM 서비스계정 인증 실패:", e);
    return null;
  }
}

/** FCM 400 응답이 "토큰 무효(UNREGISTERED)"일 때만 true — 그 외 400은 페이로드 문제라 구독을 지우면 안 됨. */
async function fcmTokenIsDead(r: Response): Promise<boolean> {
  if (r.status === 404) return true;
  if (r.status !== 400) return false;
  try {
    const body = await r.json();
    const details = body?.error?.details ?? [];
    return details.some((d: { errorCode?: string }) => d?.errorCode === "UNREGISTERED") ||
      /unregistered|not.?registered/i.test(String(body?.error?.message ?? ""));
  } catch {
    return false;
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

  // 페이로드 검증: 길이 상한 + url 은 앱 내 상대경로만(오픈 리다이렉트 방지)
  const type_key = String(payloadIn.type_key ?? "test");
  const title = String(payloadIn.title ?? "Roxlogy").slice(0, 120);
  const body = payloadIn.body != null ? String(payloadIn.body).slice(0, 1000) : null;
  const urlRaw = payloadIn.url != null ? String(payloadIn.url) : "/dashboard";
  const url = /^\/(?!\/)/.test(urlRaw) && !urlRaw.includes("\\") ? urlRaw.slice(0, 500) : "/dashboard";
  const data = (payloadIn.data as Record<string, unknown>) ?? {};
  const msg = JSON.stringify({ title, body, url, data });
  if (msg.length > 3500) return json({ error: "payload too large" }, 400);

  // 옵트아웃 존중 (test 는 항상 발송, 미등록 종류는 거부)
  if (type_key !== "test") {
    const { data: typeRow } = await admin.from("notification_types")
      .select("default_enabled").eq("key", type_key).maybeSingle();
    if (!typeRow) return json({ error: "unknown type_key" }, 400);
    const { data: pref } = await admin.from("notification_prefs")
      .select("enabled").eq("user_id", targetUser).eq("type_key", type_key).maybeSingle();
    const enabled = pref ? pref.enabled : typeRow.default_enabled;
    if (!enabled) return json({ skipped: "opted_out" });
  }

  // 아웃박스 기록
  const { data: notif, error: outboxErr } = await admin.from("notifications")
    .insert({ user_id: targetUser, type_key, title, body, url, data })
    .select("id").single();
  if (outboxErr) console.error("아웃박스 기록 실패:", outboxErr.message);

  const { data: subs } = await admin.from("push_subscriptions")
    .select("*").eq("user_id", targetUser).eq("disabled", false);

  const fcmToken = FCM_SA ? await fcmAccessToken(FCM_SA) : null;
  const fcmProject = FCM_SA ? (() => { try { return JSON.parse(FCM_SA).project_id; } catch { return null; } })() : null;

  // 플랫폼별 스킵 사유를 응답에 노출 — "200 인데 아무 일도 없음" 디버깅 지옥 방지
  const errors: string[] = [];
  const hasWebSub = (subs ?? []).some((s) => s.platform === "web");
  const hasAndroidSub = (subs ?? []).some((s) => s.platform === "android");
  if (hasWebSub && !canWeb) errors.push("web:no_vapid");
  if (hasAndroidSub && (!fcmToken || !fcmProject)) errors.push("android:no_fcm_auth");

  let sent = 0, pruned = 0, failed = 0;
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
        if (r.ok) sent++;
        // 400 은 UNREGISTERED 일 때만 정리 — 그 외 400(페이로드 문제)에 구독을 지우면
        // 잘못된 브로드캐스트 1회로 멀쩡한 안드로이드 구독 전체가 삭제되는 참사가 남.
        else if (await fcmTokenIsDead(r)) { await admin.from("push_subscriptions").delete().eq("id", s.id); pruned++; }
        else { failed++; console.error(`FCM 발송 실패 status=${r.status} sub=${s.id}`); }
      }
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); pruned++; }
      else { failed++; console.error("발송 예외:", e); }
    }
  }

  // 실제 1건 이상 나갔을 때만 sent_at 스탬프 — "보냈다"는 기록이 거짓이 되지 않게
  if (notif?.id && sent > 0) {
    await admin.from("notifications").update({ sent_at: new Date().toISOString() }).eq("id", notif.id);
  }
  return json({ ok: true, sent, pruned, failed, subs: subs?.length ?? 0, errors });
});
