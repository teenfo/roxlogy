import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let locale: unknown;
  try {
    ({ locale } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!isLocale(locale))
    return NextResponse.json({ error: "unsupported locale" }, { status: 400 });

  // 로그인 상태면 프로필에도 남긴다 — 서버에서 보내는 푸시 알림이 이 값으로
  // 언어를 고른다 (쿠키는 서버 크론에서 읽을 수 없다). 실패해도 무시.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await supabase.from("profiles").update({ locale }).eq("id", user.id);
  } catch {
    /* 비로그인·네트워크 오류는 쿠키만으로 충분하다 */
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
