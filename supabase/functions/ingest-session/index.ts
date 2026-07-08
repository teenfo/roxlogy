// S2 세션 수신 API — docs/API_CONTRACT.md 계약 구현.
// 역할: 크기·형태의 값싼 사전 검증 + JWT 확인 후, 트랜잭션 처리는
// public.ingest_session RPC(마이그레이션 005)에 위임한다.
// service role 키는 사용하지 않는다 — 소유권·LWW는 auth.uid() 기준.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB (계약)
const MAX_SEGMENTS = 64;
const MAX_SAMPLES = 30_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    return json({ error: "payload_too_large" }, 413);

  let body: {
    session?: Record<string, unknown>;
    segments?: { erg?: { samples?: unknown[] } }[];
  };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const s = body?.session;
  if (
    !s ||
    typeof s.id !== "string" ||
    typeof s.started_at !== "string" ||
    typeof s.client_updated_at !== "string"
  )
    return json({ error: "invalid_session" }, 400);

  if (body.segments !== undefined) {
    if (!Array.isArray(body.segments) || body.segments.length > MAX_SEGMENTS)
      return json({ error: "invalid_segments" }, 400);
    let total = 0;
    for (const g of body.segments) {
      const n = Array.isArray(g?.erg?.samples) ? g.erg!.samples!.length : 0;
      total += n;
    }
    if (total > MAX_SAMPLES) return json({ error: "too_many_samples" }, 413);
  }

  // 호출자 JWT를 그대로 전달 — RPC 내부의 auth.uid()가 소유권을 판정
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthenticated" }, 401);

  const { data, error } = await supabase.rpc("ingest_session", { p: body });
  if (error) {
    const msg = error.message ?? "internal";
    if (/unauthenticated/.test(msg)) return json({ error: "unauthenticated" }, 401);
    if (/too_many_samples/.test(msg)) return json({ error: "too_many_samples" }, 413);
    if (/invalid_session|invalid_segments/.test(msg))
      return json({ error: msg.match(/invalid_\w+/)?.[0] ?? "invalid" }, 400);
    console.error("ingest_session rpc error:", msg);
    return json({ error: "internal" }, 500);
  }
  return json(data, 200);
});
