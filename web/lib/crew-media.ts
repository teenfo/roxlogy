/**
 * 크루 게시물 이미지 주소 거르기 — 본문 마크다운 이미지와 `crew_posts.image_urls` 가 같이 쓴다.
 *
 * 업로드 기능은 두지 않는다(2026-10-01 결정). 이미지는 **외부 링크로만** 넣는다 —
 * 그래서 우리 스토리지뿐 아니라 바깥 주소도 그린다. 대신 아래로 위험을 줄인다:
 *   - `https:` 만. `http:`(혼합 콘텐츠)·`data:`·`javascript:` 등은 버린다.
 *   - 그리는 쪽에서 `referrerPolicy="no-referrer"` + `loading="lazy"` — 이미지 서버에
 *     어느 글에서 왔는지를 넘기지 않고, 화면에 들어오기 전에는 요청하지 않는다.
 * 남는 위험(알고 받아들인 것): 글을 연 사람의 IP·열람 시각은 이미지 서버에 남는다(추적 픽셀).
 *
 * 순서는 그대로 둔다 — 배열 순서가 곧 표시 순서다(설명·그림이 짝을 이루는 글이 있다).
 * `next/image` 는 쓰지 않는다: remotePatterns 를 열어야 하고, GIF 애니메이션을 그대로 보여야 한다.
 */
export function postImageUrls(urls: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!urls?.length) return [];
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string") continue;
    try {
      const p = new URL(u.trim());
      if (p.protocol === "https:" && p.hostname) out.push(p.href);
    } catch {
      /* 주소가 아니면 버린다 */
    }
  }
  return out;
}
