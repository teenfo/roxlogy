import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 서비스워커의 pushsubscriptionchange 복구용 — 브라우저가 푸시 구독을 로테이션하면
 * SW가 이 라우트로 새 구독을 보고한다(쿠키 세션 인증, RLS로 본인 행만).
 * 이전 endpoint 행은 지우고 새 endpoint 를 업서트한다.
 */
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

  if (body.oldEndpoint && body.oldEndpoint !== body.endpoint) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.oldEndpoint);
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
