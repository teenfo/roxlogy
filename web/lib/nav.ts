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
  /** 아이콘 이름 — components/rox/app-shell.tsx 가 lucide 아이콘으로 매핑한다 */
  icon: string;
};

export type NavItem = {
  key: string;
  href: string;
  label: DictKey;
  /** 아이콘 이름 — components/rox/app-shell.tsx 가 lucide 아이콘으로 매핑한다 */
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
 * 데스크톱 사이드바 그룹 (디자인 스펙 1.3 §04 · 감사보고서 §3).
 *
 * 모바일 하단 탭(`NAV`)과 **목록이 다르다** — 일부러 그렇다. 하단 탭은 5칸이라
 * 자주 가는 곳만 담고(스펙 §15 가 그 5개를 확정했다), 사이드바는 화면이 넓으니
 * 대시보드·분석 리포트까지 펼쳐 놓는다. 둘 다 이 파일 하나에서 나온다.
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
