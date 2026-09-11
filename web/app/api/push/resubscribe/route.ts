import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 서비스워커의 pushsubscriptionchange 복구용 — 브라우저가 푸시 구독을 로테이션하면
 * SW가 이 라우트로 새 구독을 보고한다(쿠키 세션 인증, RLS로 본인 행만).
 * 이전 endpoint 행은 지우고 새 endpoint 를 업서트한다.
 */

// ── Web Push endpoint 허용 목록 (감사 R02) ─────────────────────────────────────
// endpoint 는 본인 행에 임의로 넣을 수 있는 텍스트고 발송 함수가 그 URL 로 요청하므로,
// 저장 단계에서도 알려진 푸시 공급자만 받는다. DB CHECK(is_push_endpoint_allowed,
// 마이그레이션 087)·Edge push-dispatch·push-send 와 같은 계약 — 목록을 바꾸면 네 곳을 함께 고친다.
// 근거(실제 브라우저 푸시 서비스 호스트):
//   · fcm.googleapis.com — Chrome·Edge(Chromium)·Opera·Brave·Samsung Internet (/fcm/send/…, /wp/…)
//   · updates.push.services.mozilla.com — Firefox(autopush)
//   · web.push.apple.com, *.push.apple.com — Safari. WebKit 문서가 push.apple.com 하위 도메인 전체 허용을 안내
//   · *.notify.windows.com, *.wns.windows.com — 구 EdgeHTML(WNS, 예: wns2-bl2p.notify.windows.com/w/)
const PUSH_HOST_EXACT = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIX = ["push.apple.com", "notify.windows.com", "wns.windows.com"]; // 이 도메인의 하위 도메인
const reEsc = (s: string) => s.replace(/\./g, "\\.");
// DB 의 is_push_endpoint_allowed 정규식과 문자 단위로 같아야 한다. 원문에 적용하므로 URL 파서가
// "고쳐 주는" 입력(공백·#·백슬래시·퍼센트 인코딩된 호스트·개행)을 저장 규칙과 똑같이 거부한다 —
// 파서만 쓰면 여기서는 통과하고 DB CHECK 에서 500 으로 죽는 식으로 두 계층의 판정이 어긋난다.
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    endpoint?: string;
    p256dh?: string;
    auth?: string;
    oldEndpoint?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  // 허용 목록 밖 endpoint 는 저장하지 않는다 — DB CHECK 가 한 번 더 막지만 여기서 400 으로 끝낸다
  if (!isAllowedPushEndpoint(body.endpoint)) {
    return NextResponse.json({ error: "endpoint_not_allowed" }, { status: 400 });
  }
  if (typeof body.p256dh !== "string" || typeof body.auth !== "string" ||
      body.p256dh.length > 512 || body.auth.length > 128) {
    return NextResponse.json({ error: "bad keys" }, { status: 400 });
  }

  if (body.oldEndpoint && body.oldEndpoint !== body.endpoint) {
    // 옛 행 삭제 실패는 치명적이지 않다(발송 시 404/410 으로 정리됨) — 로그만 남기고 계속
    const { error: delErr } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.oldEndpoint);
    if (delErr) console.error("resubscribe: 옛 구독 삭제 실패:", delErr.message);
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      platform: "web",
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      last_seen: new Date().toISOString(),
      disabled: false,
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
