"use client";

import { usePathname } from "next/navigation";

/**
 * 크루 커버 이미지 — 탭 화면에서만 보여준다.
 *
 * 모임 상세·게시글처럼 한 단계 더 들어간 화면에서는 첫 화면을 배너가 다 먹어
 * 정작 읽으러 온 내용이 스크롤 아래로 밀린다. 로고 + 크루명 헤더는 그대로
 * 남으므로 어느 크루인지는 계속 보인다.
 *
 * layout.tsx 가 서버 컴포넌트라 경로를 모르므로 판정만 클라이언트에서 한다.
 */
export function CrewCover({ src, slug }: { src: string; slug: string }) {
  const pathname = usePathname();
  const base = `/crews/${slug}`;
  const depth = pathname.startsWith(base)
    ? pathname.slice(base.length).split("/").filter(Boolean).length
    : 0;
  // 0 = 소개, 1 = 탭(schedule·board·members…), 2+ = 상세·작성 화면
  if (depth >= 2) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="mb-6 h-36 w-full rounded-md object-cover sm:h-52"
    />
  );
}
