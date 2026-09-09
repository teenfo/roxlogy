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
