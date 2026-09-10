/** 외부에 붙일 절대 주소의 단일 출처. robots·sitemap 과 같은 도메인을 쓴다.
 *  서버 컴포넌트에서 호출되므로 요청 호스트가 아니라 고정 값을 쓴다 —
 *  프리뷰 배포에서 만든 링크가 프리뷰 도메인으로 새어 나가면 안 된다. */
export const SITE_URL = "https://roxlogy.com";

export function siteUrl(): string {
  return SITE_URL;
}

/**
 * 로그인 후 돌아갈 경로 검증.
 *
 * next 는 쿼리스트링으로 들어와 그대로 router.push()/redirect() 에 실린다.
 * "//evil.com" 같은 값은 프로토콜 상대 URL 이라 외부 사이트로 튕겨 나간다
 * (오픈 리다이렉트). 같은 사이트의 절대경로만 통과시킨다.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

/**
 * 로그인 후 돌아갈 경로를 담는 쿠키.
 *
 * OAuth 의 redirectTo 쿼리로 실어 보내면 Supabase 의 Redirect URL 허용 목록에
 * 쿼리까지 맞는 패턴이 있어야 한다 — 없으면 Supabase 는 조용히 Site URL 로
 * 보내 버리고, 사용자는 원래 보려던 화면 대신 첫 화면에 떨어진다
 * (2026-09-10 실제 증상). 그래서 목적지는 쿠키로 들고 간다: redirectTo 는
 * 언제나 /auth/callback 하나뿐이라 허용 목록도 한 줄이면 된다.
 */
export const NEXT_COOKIE = "rox_next";

/** 브라우저에서만 — 로그인 흐름을 시작하기 직전에 부른다. 10분이면 충분하다. */
export function rememberNext(next: string | null | undefined): void {
  const safe = safeNext(next);
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = safe
    ? `${NEXT_COOKIE}=${encodeURIComponent(safe)}; Path=/; Max-Age=600; SameSite=Lax${secure}`
    : `${NEXT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
