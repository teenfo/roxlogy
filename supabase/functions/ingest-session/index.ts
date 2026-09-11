// S2 세션 수신 API — docs/API_CONTRACT.md 계약 구현.
// 역할: 크기·형태의 값싼 사전 검증 + JWT 확인 후, 트랜잭션 처리는
// public.ingest_session RPC(마이그레이션 005·026·086)에 위임한다.
// service role 키는 사용하지 않는다 — 소유권·LWW는 auth.uid() 기준.
//
// 처리 순서(감사 R04): Content-Length 거부 → 인증 → 상한까지만 본문 읽기 → 파싱·검증 → RPC.
// 예전엔 req.text() 로 본문을 통째로 읽은 뒤 크기를 쟀다 — 인증도 안 된 요청이
// 2MB 를 훨씬 넘는 본문을 메모리에 올릴 수 있었다.
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

/** 본문을 최대 `max` 바이트까지만 읽는다. 넘으면 나머지를 읽지 않고 스트림을 끊은 뒤
 *  null 을 돌려준다. Content-Length 가 없거나(chunked) 거짓인 요청도 여기서 잡힌다 —
 *  메모리에 쌓이는 양이 상한에 묶이는 실제 방어선. */
async function readBodyBounded(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1) 본문을 한 바이트도 읽기 전에: 선언된 길이가 상한을 넘으면 바로 413.
  //    헤더가 없거나 거짓이면 아래 bounded read 가 잡는다.
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES)
    return json({ error: "payload_too_large" }, 413);

  // 2) 인증 — 본문보다 먼저. 토큰이 없거나 틀린 요청은 본문을 읽지 않는다.
  //    호출자 JWT를 그대로 전달 — RPC 내부의 auth.uid()가 소유권을 판정
  const authz = req.headers.get("Authorization") ?? "";
  if (!authz) return json({ error: "unauthenticated" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authz } } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthenticated" }, 401);

  // 3) 본문은 상한까지만 읽는다
  const text = await readBodyBounded(req, MAX_BODY_BYTES);
  if (text === null) return json({ error: "payload_too_large" }, 413);

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

  const { data, error } = await supabase.rpc("ingest_session", { p: body });
  if (error) {
    const msg = error.message ?? "internal";
    // 정지 계정(마이그레이션 086): PostgREST pre-request 관문(POST /rpc 차단)과 RPC 본문
    // 둘 다 같은 메시지를 낸다. 4xx 라 클라이언트는 재시도하지 않는다.
    if (/account_disabled/.test(msg)) return json({ error: "account_disabled" }, 403);
    if (/unauthenticated/.test(msg)) return json({ error: "unauthenticated" }, 401);
    if (/too_many_samples/.test(msg)) return json({ error: "too_many_samples" }, 413);
    if (/invalid_session|invalid_segments/.test(msg))
      return json({ error: msg.match(/invalid_\w+/)?.[0] ?? "invalid" }, 400);
    // 형식이 틀린 uuid·타임스탬프·정수는 RPC 의 캐스트에서 22P02 로 터진다.
    // 계약상 스키마 위반은 4xx(수정 필요) — 500 으로 내리면 클라이언트가
    // 영구 실패 페이로드에 백오프 재시도를 전부 소모한다.
    if (/invalid input syntax|invalid input value|22P02|date\/time field value out of range/i.test(msg))
      return json({ error: "invalid_payload", detail: msg.slice(0, 200) }, 400);
    console.error("ingest_session rpc error:", msg);
    return json({ error: "internal" }, 500);
  }
  return json(data, 200);
});
