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
  icon: string;
};

export type NavItem = {
  key: string;
  href: string;
  label: DictKey;
  /** 모바일 하단 탭바 아이콘 */
  icon: string;
  children?: NavChild[];
};

export const NAV: NavItem[] = [
  { key: "sessions", href: "/sessions", label: "nav.sessions", icon: "▶" },
  {
    key: "training",
    href: "/programs",
    label: "nav.grpTraining",
    icon: "≡",
    children: [
      {
        href: "/programs",
        label: "nav.programs",
        desc: "nav.d.programs",
        icon: "≡",
      },
      { href: "/runs", label: "nav.runs", desc: "nav.d.runs", icon: "→" },
      {
        href: "/schedule",
        label: "nav.schedule",
        desc: "nav.d.schedule",
        icon: "◷",
      },
      {
        href: "/exercises",
        label: "nav.exercises",
        desc: "nav.d.exercises",
        icon: "◇",
      },
    ],
  },
  {
    key: "race",
    href: "/races",
    label: "nav.grpRace",
    icon: "⚑",
    children: [
      { href: "/races", label: "nav.races", desc: "nav.d.races", icon: "⚑" },
      { href: "/pft", label: "nav.pft", desc: "nav.d.pft", icon: "◎" },
      {
        href: "/events",
        label: "nav.events",
        desc: "nav.d.events",
        icon: "◷",
      },
      {
        href: "/predict",
        label: "nav.predict",
        desc: "nav.d.predict",
        icon: "◔",
      },
      { href: "/goals", label: "nav.goals", desc: "nav.d.goals", icon: "◈" },
      {
        href: "/leaderboard",
        label: "nav.leaderboard",
        desc: "nav.d.leaderboard",
        icon: "≣",
      },
    ],
  },
  { key: "crews", href: "/crews", label: "nav.crews", icon: "∞" },
  { key: "feed", href: "/feed", label: "nav.feed", icon: "◫" },
];

/** 현재 경로가 어느 1차 메뉴에 속하는가 */
export function activeNavKey(pathname: string): string | null {
  for (const item of NAV) {
    const hrefs = [item.href, ...(item.children?.map((c) => c.href) ?? [])];
    if (hrefs.some((h) => pathname === h || pathname.startsWith(`${h}/`))) {
      return item.key;
    }
  }
  return null;
}
