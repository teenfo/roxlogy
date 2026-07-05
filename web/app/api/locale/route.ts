import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

export async function POST(request: Request) {
  let locale: unknown;
  try {
    ({ locale } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!isLocale(locale))
    return NextResponse.json({ error: "unsupported locale" }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
