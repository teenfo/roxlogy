// push-dispatch — 알림 아웃박스(notifications) 큐 발송기 (Phase 2/3)
// 프로듀서(follows 트리거·WOD 크론)가 삽입한 미발송 행을 원자적으로 "임대"해
// 구독(push_subscriptions)으로 팬아웃한다. pg_cron이 1분마다 pg_net으로 호출.
//
// 인증: 게이트웨이 verify_jwt(유효 JWT 필요). 크론은 anon 키(공개)로 호출한다.
// 익명 호출로 조기/중복 실행돼도 무해 — 클레임이 원자적(claim_push_notifications:
// FOR UPDATE SKIP LOCKED + claimed_at 임대)이라 같은 행을 두 실행이 동시에 잡지 않고,
// 발송 권한은 내부 env(SERVICE_ROLE)로만 행사된다.
//
// 재시도(감사 A05): 예전에는 클레임하면서 sent_at 을 먼저 찍어 외부 발송이 503·타임아웃으로
// 실패해도 완료로 남았다. 지금은 임대(claimed_at)만 하고, 결과를 settle_push_notifications 로
// 정산한다(마이그레이션 087):
//   · 실패한 기기가 하나라도 있으면 retry — attempts+1·백오프(1m→5m→30m). 이번에 받은 기기는
//     delivered 로 넘겨 다음 시도에서 제외되므로(클레임이 delivered_sub_ids 를 돌려줌) 성공 기기에
//     중복 발송 없이 실패 기기만 다시 처리된다. 4번째 실패는 종결(한 기기라도 받았으면 sent_at).
//   · 남은 대상이 전부 성공(또는 이미 받음)이면 sent → sent_at.
//   · 보낼 대상이 없으면 drop(failed_at + 사유).
//   · 구독 조회 실패·실행 예산 초과처럼 시도조차 못 한 행은 release — 임대만 풀고 attempts 유지.
//   실행이 중간에 죽으면 5분 뒤 임대가 만료돼 다시 잡힌다.
// 팬아웃 로직은 push-send 와 동일 계약(변경 시 두 함수 함께 수정).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@roxlogy.com";
const FCM_SA = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";

// 공급자 1건 요청 상한. 공급자가 응답 없이 매달리면 배치 전체가 런타임 벽시계 한도까지 멈추고
// 정산이 실행되지 않아 attempts 가 오르지 않는다(임대 만료로만 복구되던 경로) — 그래서 web-push 의
// 소켓 타임아웃(options.timeout)과 별개로 Promise 경주로 전체 시간도 자른다.
const REQUEST_TIMEOUT_MS = 10_000;
// 한 실행의 팬아웃 예산. 넘기면 남은 행은 release(임대 해제, attempts 유지)로 다음 분 크론에 넘긴다.
// 임대(5분)보다 충분히 짧아야 이 실행의 늦은 정산이 다른 실행의 임대와 겹치지 않는다.
const BATCH_BUDGET_MS = 60_000;

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
// DB CHECK(is_push_endpoint_allowed, 마이그레이션 087)·web resubscribe route 와 같은 계약 —
// 목록을 바꾸면 네 곳을 함께 고친다. 근거(실제 브라우저 푸시 서비스 호스트):
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
type Settle = { id: string; outcome: Outcome; error: string | null; delivered: string[] };
type Tally = {
  sent: number; failed: number; pruned: number; rejected: number;
  prior: number;          // 이전 시도에서 이미 받은 기기 수(이번 대상에서 제외됨)
  delivered: string[];    // 이번 실행에서 받은 구독 id
  errs: string[];
};
type ClaimedRow = {
  id: string; user_id: string; type_key: string; title: string; body: string | null;
  url: string | null; data: Record<string, unknown> | null; attempts: number;
  delivered_sub_ids: string[] | null;
};

/** 알림 1건의 기기별 결과를 정산 항목으로 접는다 — push-send 와 같은 규칙. */
function classify(id: string, t: Tally): Settle {
  const summary = `sent=${t.sent} failed=${t.failed} pruned=${t.pruned} rejected=${t.rejected}` +
    (t.prior > 0 ? ` prior=${t.prior}` : "") +
    (t.errs.length ? `: ${t.errs.join("; ")}` : "");
  // 실패한 기기가 하나라도 있으면 재시도 — 받은 기기는 delivered 로 넘겨 다음 시도에서 제외한다(중복 없음)
  if (t.failed > 0) return { id, outcome: "retry", error: summary, delivered: t.delivered };
  // 남은 대상이 전부 성공(또는 이전 시도에서 이미 받음) → 완료. 정리/거부/이전 요약은 last_error 에.
  if (t.sent + t.prior > 0) {
    return { id, outcome: "sent", error: t.pruned + t.rejected + t.prior > 0 ? summary : null, delivered: t.delivered };
  }
  // 구독이 없거나 전부 죽음/거부 — 재시도해도 같으니 종결(sent_at 은 찍지 않음)
  return { id, outcome: "drop", error: t.pruned + t.rejected > 0 ? summary : "no_subscriptions", delivered: [] };
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(URL_, SERVICE);
  const startedAt = Date.now();

  // 임대 클레임 — sent_at 은 건드리지 않는다. 24시간 넘게 미발송·백오프 미도래·임대 중인 행은 제외.
  const claimRes = await admin.rpc("claim_push_notifications", { p_limit: 200 });
  if (claimRes.error) return json({ error: claimRes.error.message }, 500);
  const claimed = (claimRes.data ?? []) as ClaimedRow[];
  if (claimed.length === 0) return json({ ok: true, dispatched: 0 });

  const settle = async (results: Settle[]) => {
    if (results.length === 0) return;
    const { error } = await admin.rpc("settle_push_notifications", { p_results: results });
    // 정산 실패면 임대가 5분 뒤 만료돼 다시 잡힌다(attempts 는 오르지 않음) — 로그만 남긴다
    if (error) console.error("정산 실패(임대 만료 후 재처리됨):", error.message);
  };

  // 대상 사용자들의 구독을 한 번에 로드. 조회 자체가 실패하면(DB/PostgREST 장애) 대상에게 시도조차
  // 못 한 것이므로 release — attempts 를 올리지 않고 임대만 풀어 다음 분에 그대로 다시 잡히게 한다.
  // 예전처럼 조용히 "발송 완료"가 돼서도, 인프라 장애 36분에 큐 전체가 소진 종결돼서도 안 된다.
  const userIds = [...new Set(claimed.map((n) => n.user_id))];
  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("*")
    .in("user_id", userIds)
    .eq("disabled", false);
  if (subsErr) {
    await settle(claimed.map((n) => ({
      id: n.id, outcome: "release" as const, error: `subs_query: ${subsErr.message}`, delivered: [],
    })));
    return json({ error: subsErr.message }, 500);
  }
  type Sub = NonNullable<typeof subs>[number];
  const byUser = new Map<string, Sub[]>();
  for (const s of subs ?? []) {
    const arr = byUser.get(s.user_id) ?? [];
    arr.push(s);
    byUser.set(s.user_id, arr);
  }

  const fcmToken = FCM_SA ? await fcmAccessToken(FCM_SA) : null;
  const fcmProject = FCM_SA ? (() => { try { return JSON.parse(FCM_SA).project_id; } catch { return null; } })() : null;

  let sent = 0, pruned = 0, failed = 0, rejected = 0;
  const deadSubIds = new Set<string>();
  const rejectedSubIds = new Set<string>();
  const results: Settle[] = [];

  let idx = 0;
  for (; idx < claimed.length; idx++) {
    if (Date.now() - startedAt > BATCH_BUDGET_MS) break;
    const n = claimed[idx];
    // 이전 시도에서 이미 받은 기기는 제외 — 실패한 기기만 다시 보낸다
    const prior = new Set(n.delivered_sub_ids ?? []);
    const targets = (byUser.get(n.user_id) ?? []).filter((s) => !prior.has(s.id));
    const msg = JSON.stringify({ title: n.title, body: n.body, url: n.url ?? "/dashboard", data: n.data ?? {} });
    const t: Tally = { sent: 0, failed: 0, pruned: 0, rejected: 0, prior: prior.size, delivered: [], errs: [] };
    for (const s of targets) {
      if (deadSubIds.has(s.id)) { t.pruned++; continue; }
      if (rejectedSubIds.has(s.id)) { t.rejected++; continue; }
      try {
        if (s.platform === "web") {
          // 허용 목록 밖 endpoint 는 발송 거부 — 재시도 대상이 아니다(구독 자체가 잘못됨).
          // 지우지는 않는다: DB CHECK(087)가 새 저장을 막고, 기존 위반 행은 마이그레이션 로그로 운영자가 정리.
          if (!isAllowedPushEndpoint(s.endpoint) || !s.p256dh || !s.auth) {
            rejectedSubIds.add(s.id);
            t.rejected++;
            t.errs.push(`web:endpoint_rejected sub=${s.id}`);
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
          if (!s.fcm_token) { rejectedSubIds.add(s.id); t.rejected++; t.errs.push("android:no_token"); continue; }
          if (!fcmToken || !fcmProject) { t.failed++; t.errs.push("android:no_fcm_auth"); continue; }
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
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (r.ok) { t.sent++; t.delivered.push(s.id); }
          else if (await fcmTokenIsDead(r)) { deadSubIds.add(s.id); t.pruned++; }
          else { t.failed++; t.errs.push(`fcm:${r.status}`); console.error(`FCM 발송 실패 status=${r.status} sub=${s.id}`); }
        } else {
          t.rejected++;
          t.errs.push(`unknown_platform:${s.platform}`);
        }
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) { deadSubIds.add(s.id); t.pruned++; }
        else {
          // 5xx·타임아웃(Socket timeout / timeout:webpush / AbortError)·네트워크 오류 → 이 기기는 재시도
          t.failed++;
          t.errs.push(`${s.platform}:${code ?? (e as { message?: string })?.message?.slice(0, 60) ?? "exception"}`);
          console.error("발송 예외:", e);
        }
      }
    }
    sent += t.sent; failed += t.failed; rejected += t.rejected;
    results.push(classify(n.id, t));
  }
  // 예산 초과로 손대지 못한 행은 임대만 풀어 다음 분에 넘긴다(attempts 유지)
  const released = claimed.length - idx;
  for (; idx < claimed.length; idx++) {
    results.push({ id: claimed[idx].id, outcome: "release", error: "batch_budget", delivered: [] });
  }

  if (deadSubIds.size > 0) {
    const { error } = await admin.from("push_subscriptions").delete().in("id", [...deadSubIds]);
    if (error) console.error("죽은 구독 정리 실패:", error.message);
    else pruned = deadSubIds.size;
  }

  await settle(results);

  const retried = results.filter((r) => r.outcome === "retry").length;
  const dropped = results.filter((r) => r.outcome === "drop").length;
  return json({ ok: true, dispatched: claimed.length, sent, pruned, failed, rejected, retried, dropped, released });
});
