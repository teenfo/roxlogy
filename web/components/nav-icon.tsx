/**
 * 내비게이션 아이콘 — 단일 SVG 세트 (UI 감사 2026-09-12 P2).
 * 예전에는 ▶ ≡ ⚑ ∞ ◫ 같은 문자 기호를 썼는데 OS·폰트마다 굵기와 정렬이 달랐다.
 * 1.75px 스트로크, 24 viewBox, currentColor — 크기는 className 으로 정한다.
 */
export type NavIconName =
  | "play" | "list" | "flag" | "crews" | "feed" | "run" | "clock" | "diamond"
  | "target" | "gauge" | "goal" | "rank" | "search" | "bell" | "watch" | "chevron";

const PATHS: Record<NavIconName, string> = {
  play: "M7 4.5v15l12-7.5z",
  list: "M4 7h16M4 12h16M4 17h16",
  flag: "M5 21V4h11l-1.5 4L16 12H5",
  crews: "M8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5m0 0c0-3 2.5-5 5.5-5s2.5.5 2.5 5",
  feed: "M4 5h16v14H4zM4 10h16M10 10v9",
  run: "M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM6 21l3-7-2-2 3-4 3 2 3-1M9 14l3 3-1 4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  diamond: "M12 3l8 9-8 9-8-9z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  gauge: "M4 17a8 8 0 1 1 16 0M12 17l4-6",
  goal: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  rank: "M4 20h4v-8H4zM10 20h4V4h-4zM16 20h4v-11h-4z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1.5L20 20",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  watch: "M8 7V3h8v4M8 17v4h8v-4M6 7h12v10H6zM12 10v3l2 1",
  chevron: "M6 9l6 6 6-6",
};

/** 옛 문자 기호 → 아이콘 이름. NAV 가 문자열을 쓰던 시절 값이 남아 있어도 깨지지 않게 */
const LEGACY: Record<string, NavIconName> = {
  "▶": "play", "≡": "list", "⚑": "flag", "∞": "crews", "◫": "feed", "→": "run",
  "◷": "clock", "◇": "diamond", "◎": "target", "◔": "gauge", "◈": "goal", "≣": "rank",
  "⌕": "search", "⌚": "watch",
};

export function NavIcon({
  name,
  className = "h-5 w-5",
}: {
  name: NavIconName | string;
  className?: string;
}) {
  const key = (name in PATHS ? name : LEGACY[name] ?? "list") as NavIconName;
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={PATHS[key]} />
    </svg>
  );
}
