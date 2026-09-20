"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "./ui";

/**
 * 크루 탭 — 시안 NavTabs 에 현재 경로를 넘긴다. 시안은 정확히 같은 경로만 활성으로
 * 보지만 우리는 하위 경로(/schedule/[eventId], /board/[postId])도 그 탭이다 —
 * 가장 긴 접두어 일치를 고른다.
 */
export function CrewNavTabs({ items }: { items: [string, string][] }) {
  const path = usePathname() ?? "";
  let selected = "";
  for (const [, href] of items) {
    if ((path === href || path.startsWith(href + "/")) && href.length > selected.length) {
      selected = href;
    }
  }
  return <NavTabs items={items} path={selected} />;
}
