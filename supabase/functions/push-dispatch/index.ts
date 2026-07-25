// push-dispatch — 알림 아웃박스(notifications) 큐 발송기 (Phase 2/3)
// 프로듀서(follows 트리거·WOD 크론)가 삽입한 미발송 행을 원자적으로 클레임해
// 구독(push_subscriptions)으로 팬아웃한다. pg_cron이 1분마다 pg_net으로 호출.
//
// 인증: 게이트웨이 verify_jwt(유효 JWT 필요). 크론은 anon 키(공개)로 호출한다.
// 익명 호출로 조기/중복 실행돼도 무해 — 클레임이 원자적(update ... is null returning)이라
// 각 알림은 정확히 한 번만 발송되고, 발송 권한은 내부 env(SERVICE_ROLE)로만 행사된다.
// 팬아웃 로직은 push-send 와 동일 계약(변경 시 두 함수 함께 수정).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@roxlogy.com";
const FCM_SA = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";

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

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(URL_, SERVICE);

  // 미발송 알림 원자적 클레임: sent_at 을 지금으로 찍으면서 가져온다(동시 실행 이중발송 방지).
  // 24시간 넘게 미발송이면 만료로 간주(디스패치 장기 중단 후 몰아치기 방지).
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: claimed, error: claimErr } = await admin
    .from("notifications")
    .update({ sent_at: new Date().toISOString() })
    .is("sent_at", null)
    .gte("created_at", cutoff)
    .select("id, user_id, type_key, title, body, url, data")
    .limit(200);
  if (claimErr) return json({ error: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) return json({ ok: true, dispatched: 0 });

  // 대상 사용자들의 구독을 한 번에 로드
  const userIds = [...new Set(claimed.map((n) => n.user_id))];
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("*")
    .in("user_id", userIds)
    .eq("disabled", false);
  const byUser = new Map<string, NonNullable<typeof subs>>();
  for (const s of subs ?? []) {
    const arr = byUser.get(s.user_id) ?? [];
    arr.push(s);
    byUser.set(s.user_id, arr);
  }

  const fcmToken = FCM_SA ? await fcmAccessToken(FCM_SA) : null;
  const fcmProject = FCM_SA ? (() => { try { return JSON.parse(FCM_SA).project_id; } catch { return null; } })() : null;

  let sent = 0, pruned = 0, failed = 0;
  const deadSubIds = new Set<string>();

  for (const n of claimed) {
    const targets = byUser.get(n.user_id) ?? [];
    const msg = JSON.stringify({ title: n.title, body: n.body, url: n.url ?? "/dashboard", data: n.data ?? {} });
    for (const s of targets) {
      if (deadSubIds.has(s.id)) continue;
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
                notification: { title: n.title, body: n.body ?? "" },
                data: { url: n.url ?? "/dashboard" },
                android: { priority: "high" },
              },
            }),
          });
          if (r.ok) sent++;
          else if (await fcmTokenIsDead(r)) deadSubIds.add(s.id);
          else { failed++; console.error(`FCM 발송 실패 status=${r.status} sub=${s.id}`); }
        }
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) deadSubIds.add(s.id);
        else { failed++; console.error("발송 예외:", e); }
      }
    }
  }

  if (deadSubIds.size > 0) {
    await admin.from("push_subscriptions").delete().in("id", [...deadSubIds]);
    pruned = deadSubIds.size;
  }

  return json({ ok: true, dispatched: claimed.length, sent, pruned, failed });
});
