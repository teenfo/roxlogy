import type { DictKey } from "@/lib/i18n/dictionaries/en";

export type CrewRoleKey = "owner" | "coach" | "member" | "associate";

/** 등급 색 팔레트 키 — DB crew_member_tiers.color 와 1:1 */
export type TierColor = "yellow" | "blue" | "chalk" | "gray" | "green" | "red";
export const TIER_COLORS: TierColor[] = [
  "yellow",
  "blue",
  "chalk",
  "gray",
  "green",
  "red",
];

const TIER_CLASS: Record<TierColor, string> = {
  yellow: "bg-accent/15 text-accent ring-1 ring-accent/40",
  blue: "bg-track/15 text-track ring-1 ring-track/40",
  chalk: "bg-foreground/10 text-foreground/80 ring-1 ring-foreground/15",
  gray: "bg-background text-muted ring-1 ring-muted/25",
  green: "bg-emerald-400/15 text-emerald-400 ring-1 ring-emerald-400/30",
  red: "bg-red-400/15 text-red-400 ring-1 ring-red-400/30",
};

/** 등급 뱃지 클래스. 색은 크루가 고른다. */
export function tierBadgeClass(color: string | null | undefined): string {
  return TIER_CLASS[(color ?? "gray") as TierColor] ?? TIER_CLASS.gray;
}

/** 권한(리더·부리더) 뱃지 — 등급과 섞이지 않게 색을 고정한다. */
export function crewRoleBadgeClass(role: string): string {
  switch (role) {
    case "owner":
      return TIER_CLASS.yellow;
    case "coach":
      return TIER_CLASS.blue;
    case "member":
      return TIER_CLASS.chalk;
    default:
      return TIER_CLASS.gray;
  }
}

/** 사전 키 — crew.role.owner / .coach / .member / .associate */
export function crewRoleDictKey(role: string): DictKey {
  const known = ["owner", "coach", "member", "associate"];
  return `crew.role.${known.includes(role) ? role : "member"}` as DictKey;
}

/** 리더·부리더만 권한 뱃지를 단다. 나머지는 크루가 만든 등급 뱃지로 표시. */
export function isStaffRole(role: string): boolean {
  return role === "owner" || role === "coach";
}
