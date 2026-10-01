/**
 * 크루 게시물 이미지(`crew_posts.image_urls`) 표시용 주소 거르기.
 *
 * 게시판은 활동 크루원 누구나 쓰는 칸이라, 아무 주소나 `<img>` 로 그리면 외부 추적
 * 픽셀이 박혀 글을 읽은 사람의 IP·열람 시각이 새어 나간다. 그래서 **우리 Supabase
 * 스토리지의 공개 경로(https)만** 그린다 — `crew-media`·`crew-logos` 버킷이 여기 있다.
 * 나머지 주소는 조용히 뺀다(깨진 그림을 보이는 것보다 낫다).
 *
 * 순서는 그대로 둔다 — 배열 순서가 곧 표시 순서다(설명·그림이 짝을 이루는 글이 있다).
 * `next/image` 는 쓰지 않는다: remotePatterns 설정이 없고, GIF 애니메이션을 그대로 보여야 한다.
 */
const STORAGE_PREFIX = (() => {
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return null;
    const u = new URL(base);
    return `https://${u.host}/storage/v1/object/public/`;
  } catch {
    return null;
  }
})();

export function postImageUrls(urls: readonly string[] | null | undefined): string[] {
  if (!urls?.length || !STORAGE_PREFIX) return [];
  return urls.filter((u) => typeof u === "string" && u.startsWith(STORAGE_PREFIX));
}
