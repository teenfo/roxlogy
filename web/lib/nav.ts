import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * 글로벌 네비게이션 단일 출처 (2026-09 디자인 핸드오프).
 *
 * 데스크톱 필 탭·태블릿·모바일 하단 탭바·모바일 바텀시트가 모두 이 목록을
 * 읽는다. 예전에는 desktop-nav 와 mobile-nav 가 따로 목록을 들고 있어
 * 한쪽에만 메뉴가 추가되는 일이 있었다.
 */

export type NavChild = {
  href: string;
  label: DictKey;
  desc: DictKey;
  /** 아이콘 이름 — components/nav-icon.tsx 의 SVG 세트 */
  icon: string;
};

export type NavItem = {
  key: string;
  href: string;
  label: DictKey;
  /** 아이콘 이름 — components/nav-icon.tsx 의 SVG 세트 */
  icon: string;
  children?: NavChild[];
};

export const NAV: NavItem[] = [
  { key: "sessions", href: "/sessions", label: "nav.sessions", icon: "play" },
  {
    key: "training",
    href: "/programs",
    label: "nav.grpTraining",
    icon: "list",
    children: [
      {
        href: "/programs",
        label: "nav.programs",
        desc: "nav.d.programs",
        icon: "list",
      },
      { href: "/runs", label: "nav.runs", desc: "nav.d.runs", icon: "run" },
      {
        href: "/schedule",
        label: "nav.schedule",
        desc: "nav.d.schedule",
        icon: "clock",
      },
      {
        href: "/exercises",
        label: "nav.exercises",
        desc: "nav.d.exercises",
        icon: "diamond",
      },
    ],
  },
  {
    key: "race",
    href: "/races",
    label: "nav.grpRace",
    icon: "flag",
    children: [
      { href: "/races", label: "nav.races", desc: "nav.d.races", icon: "flag" },
      { href: "/pft", label: "nav.pft", desc: "nav.d.pft", icon: "target" },
      {
        href: "/events",
        label: "nav.events",
        desc: "nav.d.events",
        icon: "clock",
      },
      {
        href: "/predict",
        label: "nav.predict",
        desc: "nav.d.predict",
        icon: "gauge",
      },
      { href: "/goals", label: "nav.goals", desc: "nav.d.goals", icon: "goal" },
      {
        href: "/leaderboard",
        label: "nav.leaderboard",
        desc: "nav.d.leaderboard",
        icon: "rank",
      },
    ],
  },
  { key: "crews", href: "/crews", label: "nav.crews", icon: "crews" },
  { key: "feed", href: "/feed", label: "nav.feed", icon: "feed" },
];

/**
 * 비로그인 방문자에게 보여줄 메뉴 — 로그인 없이 열리는 페이지만 담는다.
 * NAV 를 그대로 쓰면 모든 탭이 /login 리다이렉트로 끝나 막다른 길이 된다.
 */
export const PUBLIC_NAV: NavItem[] = [
  { key: "crews", href: "/crews", label: "nav.crews", icon: "crews" },
  { key: "events", href: "/events", label: "nav.events", icon: "clock" },
  { key: "predict", href: "/predict", label: "nav.predict", icon: "gauge" },
];

/** 현재 경로가 어느 1차 메뉴에 속하는가 */
export function activeNavKey(
  pathname: string,
  items: NavItem[] = NAV,
): string | null {
  for (const item of items) {
    const hrefs = [item.href, ...(item.children?.map((c) => c.href) ?? [])];
    if (hrefs.some((h) => pathname === h || pathname.startsWith(`${h}/`))) {
      return item.key;
    }
  }
  return null;
}
