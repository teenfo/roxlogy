import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * 글로벌 네비게이션 단일 출처 (2026-09 디자인 리뉴얼).
 *
 * 사이드바(데스크톱은 고정, 768px 미만은 상단바 트리거로 여는 드로어)가 이
 * 목록 하나를 읽는다. 예전에는 데스크톱 탭·모바일 하단 탭이 목록을 따로 들고
 * 있어 한쪽에만 메뉴가 추가되는 일이 있었다. 모바일 하단 탭바는 2026-09-20 에
 * 제거했다 — 드로어와 겹쳐 같은 메뉴가 두 번 보였다.
 */

/**
 * 사이드바 그룹 (디자인 스펙 1.3 §04 · 시안 rox-app.tsx 의 3그룹 14항목).
 */
export type NavGroup = {
  key: string;
  label: DictKey;
  items: { href: string; label: DictKey; icon: string }[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "performance",
    label: "nav.grpPerformance",
    items: [
      { href: "/dashboard", label: "nav.dashboard", icon: "gauge" },
      { href: "/sessions", label: "nav.sessions", icon: "play" },
      { href: "/races", label: "nav.races", icon: "flag" },
      { href: "/goals", label: "nav.goals", icon: "goal" },
      { href: "/insights", label: "nav.insights", icon: "diamond" },
    ],
  },
  {
    key: "training",
    label: "nav.grpTraining",
    items: [
      { href: "/schedule", label: "nav.schedule", icon: "clock" },
      { href: "/programs", label: "nav.programs", icon: "list" },
      { href: "/runs", label: "nav.runs", icon: "run" },
      { href: "/exercises", label: "nav.exercises", icon: "diamond" },
      { href: "/pft", label: "nav.pft", icon: "target" },
    ],
  },
  {
    key: "community",
    label: "nav.grpCommunity",
    items: [
      { href: "/events", label: "nav.events", icon: "clock" },
      { href: "/crews", label: "nav.crews", icon: "crews" },
      { href: "/leaderboard", label: "nav.leaderboard", icon: "rank" },
      { href: "/feed", label: "nav.feed", icon: "feed" },
    ],
  },
];

/**
 * 사이드바에서 지금 열려 있는 항목.
 *
 * 하위 경로까지 켜야 한다(`/sessions/123` 도 세션이다). 다만 `/` 로 자른
 * 접두어 비교라 `/races` 가 `/races-foo` 를 먹지 않도록 경계를 확인한다.
 * 가장 긴 일치를 고른다 — `/pft` 와 `/pft/race` 처럼 겹치는 항목이 있다.
 */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (pathname === it.href || pathname.startsWith(`${it.href}/`)) {
        if (!best || it.href.length > best.length) best = it.href;
      }
    }
  }
  return best;
}
