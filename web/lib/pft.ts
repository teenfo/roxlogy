import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** PFT 6종목 — 순서 고정, 쉬는 시간 없이 연속. 총 시간이 점수다.
 *  DB pft_results 의 *_ms 컬럼과 key 가 1:1 로 대응한다. */
export const PFT_STATIONS = [
  { key: "run", col: "run_ms", label: "pft.st.run", spec: "pft.spec.run" },
  { key: "burpee", col: "burpee_ms", label: "pft.st.burpee", spec: "pft.spec.burpee" },
  { key: "lunge", col: "lunge_ms", label: "pft.st.lunge", spec: "pft.spec.lunge" },
  { key: "row", col: "row_ms", label: "pft.st.row", spec: "pft.spec.row" },
  { key: "pushup", col: "pushup_ms", label: "pft.st.pushup", spec: "pft.spec.pushup" },
  { key: "wallball", col: "wallball_ms", label: "pft.st.wallball", spec: "pft.spec.wallball" },
] as const satisfies readonly {
  key: string;
  col: string;
  label: DictKey;
  spec: DictKey;
}[];

export type PftStationKey = (typeof PFT_STATIONS)[number]["key"];
export type PftSplitCol = (typeof PFT_STATIONS)[number]["col"];

export type Badge = "gold" | "silver" | "bronze";

/** 배지 컷오프 (ms). DB pft_results.badge 생성 컬럼과 반드시 같아야 한다.
 *  45세 미만 / 45세 이상 두 구간뿐이고 성별로는 갈리지 않는다. */
export const PFT_CUTOFFS = {
  under45: { gold: 22 * 60_000, silver: 26 * 60_000 },
  over45: { gold: 24 * 60_000, silver: 28 * 60_000 },
} as const;

/** 화면 표시용 — 실제 저장 값은 DB 생성 컬럼이 정한다.
 *  나이를 모르면 더 엄격한 45세 미만 기준을 쓴다(배지를 과대 부여하지 않음). */
export function pftBadge(
  totalMs: number,
  age: number | null | undefined,
  scaled: boolean,
): Badge {
  if (scaled) return "bronze";
  const c = age != null && age >= 45 ? PFT_CUTOFFS.over45 : PFT_CUTOFFS.under45;
  if (totalMs < c.gold) return "gold";
  if (totalMs < c.silver) return "silver";
  return "bronze";
}

export function badgeClass(badge: string): string {
  switch (badge) {
    case "gold":
      return "bg-accent/15 text-accent ring-1 ring-accent/40";
    case "silver":
      return "bg-foreground/10 text-foreground/80 ring-1 ring-foreground/20";
    default:
      return "bg-[#b06a3b]/15 text-[#c98150] ring-1 ring-[#b06a3b]/40";
  }
}

export function badgeDictKey(badge: string): DictKey {
  const known = ["gold", "silver", "bronze"];
  return `pft.badge.${known.includes(badge) ? badge : "bronze"}` as DictKey;
}

/** 다음 배지까지 남은 시간(ms). 이미 골드면 null. */
export function toNextBadge(
  totalMs: number,
  age: number | null | undefined,
  scaled: boolean,
): { next: Badge; gapMs: number } | null {
  if (scaled) return null;
  const c = age != null && age >= 45 ? PFT_CUTOFFS.over45 : PFT_CUTOFFS.under45;
  if (totalMs < c.gold) return null;
  if (totalMs < c.silver) return { next: "gold", gapMs: totalMs - c.gold + 1000 };
  return { next: "silver", gapMs: totalMs - c.silver + 1000 };
}

export type PftResult = {
  id: string;
  tested_on: string;
  total_ms: number;
  run_ms: number | null;
  burpee_ms: number | null;
  lunge_ms: number | null;
  row_ms: number | null;
  pushup_ms: number | null;
  wallball_ms: number | null;
  age: number | null;
  gender: string | null;
  scaled: boolean;
  badge: Badge;
  location: string | null;
  note: string | null;
  shared: boolean;
};

export function splitOf(r: PftResult, col: PftSplitCol): number | null {
  return r[col];
}
