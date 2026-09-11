// push-send — 종류-무관 푸시 발송기 (즉시 발송 API: 테스트·직접 호출용)
// 입력: { user_id, type_key, title, body, url?, data? }
// - service_role 로 호출: 임의 user_id 에게 발송(서버 내부용).
// - 일반 로그인 사용자로 호출: 본인에게만 발송(설정 화면의 "테스트 알림").
// 큐 기반 발송(팔로워·WOD 등)은 프로듀서가 notifications 에 삽입 → push-dispatch 가 처리.
// 옵트아웃(notification_prefs) 존중 → 구독(push_subscriptions) 팬아웃(web-push/FCM)
// → 죽은 구독 정리 → notifications 아웃박스 기록.
//
// 아웃박스 행은 임대(claimed_at) 상태로 넣고 발송 뒤 settle_push_notifications 로 정산한다
// (마이그레이션 087). 예전에는 sent_at 없는 행을 그대로 넣어 발송 도중 크론(push-dispatch)이
// 같은 행을 잡아 이중 발송할 틈이 있었고, 실패는 아무 기록 없이 크론이 즉시 다시 보냈다.
// 지금은 실패한 기기가 있으면 retry(받은 기기는 delivered 로 기록해 크론의 재시도에서 제외),
// 전부 성공했을 때만 sent_at 이 찍힌다. 팬아웃 로직은 push-dispatch 와 동일 계약.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@roxlogy.com";
const FCM_SA = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";

// 공급자 1건 요청 상한 — 공급자가 매달리면 응답 없이 런타임 한도까지 멈추고 정산이 안 된다.
// web-push 의 소켓 타임아웃(options.timeout)과 별개로 Promise 경주로 전체 시간도 자른다.
const REQUEST_TIMEOUT_MS = 10_000;

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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

// ── Web Push endpoint 허용 목록 (감사 R02) ─────────────────────────────────────
// endpoint 는 사용자가 본인 행에 임의로 넣을 수 있는 텍스트라 그대로 fetch 하면 SSRF 다.
// DB CHECK(is_push_endpoint_allowed, 마이그레이션 087)·push-dispatch·web resubscribe route 와
// 같은 계약 — 목록을 바꾸면 네 곳을 함께 고친다. 근거(실제 브라우저 푸시 서비스 호스트):
//   · fcm.googleapis.com — Chrome·Edge(Chromium)·Opera·Brave·Samsung Internet (/fcm/send/…, /wp/…)
//   · updates.push.services.mozilla.com — Firefox(autopush)
//   · web.push.apple.com, *.push.apple.com — Safari. WebKit 문서가 push.apple.com 하위 도메인 전체 허용을 안내
//   · *.notify.windows.com, *.wns.windows.com — 구 EdgeHTML(WNS, 예: wns2-bl2p.notify.windows.com/w/)
const PUSH_HOST_EXACT = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIX = ["push.apple.com", "notify.windows.com", "wns.windows.com"]; // 이 도메인의 하위 도메인
const reEsc = (s: string) => s.replace(/\./g, "\\.");
// DB 의 is_push_endpoint_allowed 정규식과 문자 단위로 같아야 한다. 원문에 적용하므로 URL 파서가
// "고쳐 주는" 입력(공백·#·백슬래시·퍼센트 인코딩된 호스트·개행)을 저장 규칙과 똑같이 거부한다 —
// 파서만 쓰면 저장은 거부되는데 발송은 허용되는 식으로 두 계층의 판정이 어긋난다.
const PUSH_ENDPOINT_RE = new RegExp(
  "^https://(" +
    [...PUSH_HOST_EXACT.map(reEsc), ...PUSH_HOST_SUFFIX.map((s) => "([a-z0-9-]+\\.)+" + reEsc(s))].join("|") +
    ")(:443)?/[a-z0-9._~:/%@!$&'()*+,;=-][a-z0-9._~:/?%@!$&'()*+,;=-]*$",
  "i",
);

function isAllowedPushEndpoint(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  if (!PUSH_ENDPOINT_RE.test(raw)) return false;
  // 파서 검증(겹치기) — 실제 요청이 나가는 호스트가 허용 목록인지 정규식과 독립적으로 다시 본다.
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  // URL 파서는 기본 포트(443)를 비운다 — 그 외 포트는 푸시 서비스가 아니다
  if (u.port !== "") return false;
  // 구독 토큰 경로가 없는 URL(https://host/)은 실제 엔드포인트가 아니다
  if (u.pathname.length < 2) return false;
  const host = u.hostname.toLowerCase();
  if (host.endsWith(".")) return false;
  // IP 리터럴(IPv4 점표기·IPv6 대괄호)은 허용 목록에 있을 수 없지만, 목록이 넓어져도
  // 사설·루프백 주소로 새지 않게 명시적으로 막는다. 16진·8진 IPv4 는 파서가 점표기로 정규화한다.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":")) return false;
  return PUSH_HOST_EXACT.includes(host) || PUSH_HOST_SUFFIX.some((s) => host.endsWith("." + s));
}

async function fcmAccessToken(saJson: string): Promise<string | null> {
  try {
    const { GoogleAuth } = await import("npm:google-auth-library@9");
    const auth = new GoogleAuth({
      credentials: JSON.parse(saJson),
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    const t = await withTimeout(client.getAccessToken(), REQUEST_TIMEOUT_MS, "fcm_auth");
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

type Outcome = "sent" | "retry" | "drop" | "release";
type Tally = {
  sent: number; failed: number; pruned: number; rejected: number;
  delivered: string[];    // 이번 실행에서 받은 구독 id — retry 정산 시 크론의 재시도에서 제외된다
  errs: string[];
};

/** 기기별 결과를 정산 결과로 접는다 — push-dispatch 의 classify 와 같은 규칙(여기는 이전 시도가 없어 prior=0). */
function classify(t: Tally): { outcome: Outcome; error: string | null; delivered: string[] } {
  const summary = `sent=${t.sent} failed=${t.failed} pruned=${t.pruned} rejected=${t.rejected}` +
    (t.errs.length ? `: ${t.errs.join("; ")}` : "");
  // 실패한 기기가 하나라도 있으면 재시도 — 받은 기기는 delivered 로 넘겨 다음 시도에서 제외한다(중복 없음)
  if (t.failed > 0) return { outcome: "retry", error: summary, delivered: t.delivered };
  if (t.sent > 0) return { outcome: "sent", error: t.pruned + t.rejected > 0 ? summary : null, delivered: t.delivered };
  return { outcome: "drop", error: t.pruned + t.rejected > 0 ? summary : "no_subscriptions", delivered: [] };
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

  // 아웃박스 기록 — 임대 상태로 넣어 발송 중에 크론(push-dispatch)이 같은 행을 잡지 않게 한다.
  // 정산 전에 이 함수가 죽어도 5분 뒤 임대가 만료돼 크론이 이어받는다.
  const { data: notif, error: outboxErr } = await admin.from("notifications")
    .insert({ user_id: targetUser, type_key, title, body, url, data, claimed_at: new Date().toISOString() })
    .select("id").single();
  if (outboxErr) console.error("아웃박스 기록 실패:", outboxErr.message);

  const settle = async (outcome: Outcome, error: string | null, delivered: string[]) => {
    if (!notif?.id) return;
    const { error: settleErr } = await admin.rpc("settle_push_notifications", {
      p_results: [{ id: notif.id, outcome, error, delivered }],
    });
    if (settleErr) console.error("정산 실패(임대 만료 후 재처리됨):", settleErr.message);
  };

  const { data: subs, error: subsErr } = await admin.from("push_subscriptions")
    .select("*").eq("user_id", targetUser).eq("disabled", false);
  if (subsErr) {
    // 대상에게 시도조차 못 했다(인프라 실패) — attempts 를 올리지 않고 임대만 풀어 크론이 이어받게 한다
    await settle("release", `subs_query: ${subsErr.message}`, []);
    return json({ error: subsErr.message }, 500);
  }

  const fcmToken = FCM_SA ? await fcmAccessToken(FCM_SA) : null;
  const fcmProject = FCM_SA ? (() => { try { return JSON.parse(FCM_SA).project_id; } catch { return null; } })() : null;

  // 플랫폼별 스킵 사유를 응답에 노출 — "200 인데 아무 일도 없음" 디버깅 지옥 방지
  const errors: string[] = [];
  const hasWebSub = (subs ?? []).some((s) => s.platform === "web");
  const hasAndroidSub = (subs ?? []).some((s) => s.platform === "android");
  if (hasWebSub && !canWeb) errors.push("web:no_vapid");
  if (hasAndroidSub && (!fcmToken || !fcmProject)) errors.push("android:no_fcm_auth");

  const t: Tally = { sent: 0, failed: 0, pruned: 0, rejected: 0, delivered: [], errs: [] };
  const prune = async (id: string) => {
    const { error } = await admin.from("push_subscriptions").delete().eq("id", id);
    if (error) console.error("죽은 구독 정리 실패:", error.message);
    else t.pruned++;
  };
  for (const s of subs ?? []) {
    try {
      if (s.platform === "web") {
        // 허용 목록 밖 endpoint 는 발송 거부(SSRF). 지우지는 않는다 — DB CHECK(087)가 새 저장을 막고,
        // 기존 위반 행은 마이그레이션 로그로 운영자가 정리.
        if (!isAllowedPushEndpoint(s.endpoint) || !s.p256dh || !s.auth) {
          t.rejected++;
          t.errs.push(`web:endpoint_rejected sub=${s.id}`);
          errors.push("web:endpoint_rejected");
          console.error(`허용 목록 밖/불완전 웹 구독 — 발송 거부 sub=${s.id}`);
          continue;
        }
        if (!canWeb) { t.failed++; t.errs.push("web:no_vapid"); continue; }
        await withTimeout(
          webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            msg,
            { timeout: REQUEST_TIMEOUT_MS },
          ),
          REQUEST_TIMEOUT_MS + 2_000,
          "webpush",
        );
        t.sent++;
        t.delivered.push(s.id);
      } else if (s.platform === "android") {
        if (!s.fcm_token) { t.rejected++; t.errs.push("android:no_token"); continue; }
        if (!fcmToken || !fcmProject) { t.failed++; t.errs.push("android:no_fcm_auth"); continue; }
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (r.ok) { t.sent++; t.delivered.push(s.id); }
        // 400 은 UNREGISTERED 일 때만 정리 — 그 외 400(페이로드 문제)에 구독을 지우면
        // 잘못된 브로드캐스트 1회로 멀쩡한 안드로이드 구독 전체가 삭제되는 참사가 남.
        else if (await fcmTokenIsDead(r)) await prune(s.id);
        else { t.failed++; t.errs.push(`fcm:${r.status}`); console.error(`FCM 발송 실패 status=${r.status} sub=${s.id}`); }
      } else {
        t.rejected++;
        t.errs.push(`unknown_platform:${s.platform}`);
      }
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await prune(s.id);
      else {
        // 5xx·타임아웃(Socket timeout / timeout:webpush / AbortError)·네트워크 오류 → 이 기기는 재시도
        t.failed++;
        t.errs.push(`${s.platform}:${code ?? (e as { message?: string })?.message?.slice(0, 60) ?? "exception"}`);
        console.error("발송 예외:", e);
      }
    }
  }

  // 정산: 실패 기기가 있으면 retry(크론이 백오프로 실패 기기만 재시도), 전부 성공이면 sent_at,
  // 대상이 없으면 drop(종결, 사유 기록) — "보냈다"는 기록이 거짓이 되지 않게.
  const verdict = classify(t);
  await settle(verdict.outcome, verdict.error, verdict.delivered);
  return json({
    ok: true, sent: t.sent, pruned: t.pruned, failed: t.failed, rejected: t.rejected,
    outcome: verdict.outcome, subs: subs?.length ?? 0, errors,
  });
});
