/** 외부에 붙일 절대 주소의 단일 출처. robots·sitemap 과 같은 도메인을 쓴다.
 *  서버 컴포넌트에서 호출되므로 요청 호스트가 아니라 고정 값을 쓴다 —
 *  프리뷰 배포에서 만든 링크가 프리뷰 도메인으로 새어 나가면 안 된다. */
export const SITE_URL = "https://roxlogy.com";

export function siteUrl(): string {
  return SITE_URL;
}
