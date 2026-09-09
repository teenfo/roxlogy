import type { CookieOptions } from "@supabase/ssr";

/**
 * "로그인 상태 유지" 스위치.
 *
 * @supabase/ssr 은 인증 쿠키를 항상 400일짜리로 쓴다 — setCookieOptions 가
 * cookieOptions 를 펼친 뒤 maxAge 를 DEFAULT 로 덮어쓰기 때문에(cookies.js),
 * 옵션만으로는 끌 수 없다. 그래서 쿠키를 실제로 굽는 세 곳(브라우저·서버
 * 컴포넌트·프록시)에서 만료를 직접 걷어낸다.
 *
 * 끄면 인증 쿠키가 세션 쿠키가 되어 브라우저를 닫을 때 사라진다 — 공용 PC 용.
 * 기본값은 유지(켜짐)라 기존 사용자 동작은 그대로다.
 */
export const KEEP_COOKIE = "rox-keep";

/** 유지를 끈 상태인가 — 쿠키에 rox-keep=0 이 있을 때만 true */
export function optedOut(
  cookies: { name: string; value: string }[] | undefined,
): boolean {
  return !!cookies?.some((c) => c.name === KEEP_COOKIE && c.value === "0");
}

/**
 * 세션 쿠키로 만든다 — 만료를 없앤다.
 * 단 maxAge 0(삭제 지시)은 건드리지 않는다. 지우는 건 언제나 지워야 한다.
 */
export function sessionOnly(options: CookieOptions | undefined): CookieOptions {
  if (options?.maxAge === 0) return options;
  const next = { ...(options ?? {}) };
  delete next.maxAge;
  delete next.expires;
  return next;
}
