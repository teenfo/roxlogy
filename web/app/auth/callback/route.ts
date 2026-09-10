import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { NEXT_COOKIE, safeNext } from "@/lib/site-url";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // 목적지는 쿼리(메일 확인 링크) 또는 쿠키(OAuth) 로 온다.
  // OAuth 는 redirectTo 에 쿼리를 붙이지 못한다 — Supabase 허용 목록에 걸려
  // Site URL 로 떨어지기 때문. lib/site-url.ts 의 rememberNext 주석 참고.
  const jar = await cookies();
  const fromCookie = jar.get(NEXT_COOKIE)?.value;
  const next =
    safeNext(searchParams.get("next")) ??
    safeNext(fromCookie ? decodeURIComponent(fromCookie) : null) ??
    "/dashboard";

  const res = code
    ? await (async () => {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        return error
          ? NextResponse.redirect(`${origin}/login?error=auth`)
          : NextResponse.redirect(`${origin}${next}`);
      })()
    : NextResponse.redirect(`${origin}/login?error=auth`);

  // 한 번 쓰고 버린다 — 남겨 두면 다음 로그인이 엉뚱한 데로 간다
  res.cookies.set(NEXT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
