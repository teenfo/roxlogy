// ai-program-request — 사용자가 "AI 프로그램 생성"을 누르면 큐(ai_jobs)에 요청을 넣는다.
// 실제 생성은 analysis-dispatch 크론이 처리: 인사이트·목표·운동DB로 프롬프트 구성 →
// llm-gateway(32b) → 프로그램 실체화 → 완료 푸시 알림.
// 인증: 사용자 JWT(본인 요청만). 사용자당 동시 1건(부분 유니크).
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(URL_, SERVICE);
  // 정지 계정(profiles.disabled) 거부 — Data API 는 마이그레이션 086 의 pre-request 관문이 막지만,
  // 이 함수는 service role 로 ai_jobs 에 쓰므로 여기서 직접 확인한다(감사 A02).
  const { data: prof, error: profErr } = await admin.from("profiles")
    .select("disabled").eq("id", user.id).maybeSingle();
  if (profErr) return json({ error: profErr.message }, 500);
  if (!prof || prof.disabled) return json({ error: "account_disabled" }, 403);

  const { error } = await admin.from("ai_jobs")
    .insert({ kind: "program", user_id: user.id });
  if (error) {
    // 23505 = 이미 생성 요청이 진행 중
    if (error.code === "23505") return json({ error: "already_pending" }, 409);
    return json({ error: error.message }, 500);
  }
  return json({ ok: true, status: "queued" }, 202);
});
