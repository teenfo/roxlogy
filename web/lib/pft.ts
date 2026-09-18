import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** PFT 6종목 — 순서 고정, 쉬는 시간 없이 연속. 총 시간이 점수다.
 *  DB pft_results 의 *_ms 컬럼과 key 가 1:1 로 대응한다. */
export const PFT_STATIONS = [
  { key: "run", col: "run_ms", label: "pft.st.run", spec: "pft.spec.run", amount: "pft.amount.run", detail: "pft.detail.run" },
  { key: "burpee", col: "burpee_ms", label: "pft.st.burpee", spec: "pft.spec.burpee", amount: "pft.amount.burpee", detail: "pft.detail.burpee" },
  { key: "lunge", col: "lunge_ms", label: "pft.st.lunge", spec: "pft.spec.lunge", amount: "pft.amount.lunge", detail: "pft.detail.lunge" },
  { key: "row", col: "row_ms", label: "pft.st.row", spec: "pft.spec.row", amount: "pft.amount.row", detail: "pft.detail.row" },
  { key: "pushup", col: "pushup_ms", label: "pft.st.pushup", spec: "pft.spec.pushup", amount: "pft.amount.pushup", detail: "pft.detail.pushup" },
  { key: "wallball", col: "wallball_ms", label: "pft.st.wallball", spec: "pft.spec.wallball", amount: "pft.amount.wallball", detail: "pft.detail.wallball" },
] as const satisfies readonly {
  key: string;
  col: string;
  label: DictKey;
  /** 수량+규격 한 문장 (기존 화면 호환) */
  spec: DictKey;
  /** 수량만 — 카드에서 굵게 */
  amount: DictKey;
  /** 규격만 — 카드에서 작게 */
  detail: DictKey;
}[];

/** 종목 색 — 스플릿 바·스플릿 카드가 같은 색을 써야 어느 종목이 오래 걸렸는지
 *  화면을 옮겨도 눈으로 잇는다. 런은 세션 차트의 런(--info)과 맞춘다. */
export const PFT_COLORS: Record<string, string> = {
  run: "var(--info)",
  burpee: "var(--accent-dim)",
  lunge: "var(--cat-lime)",
  row: "var(--cat-sky)",
  pushup: "var(--warn)",
  wallball: "var(--cat-violet)",
};

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
      return "bg-gold-bg text-gold ring-1 ring-line-accent";
    case "silver":
      return "bg-line-mid text-medal-silver ring-1 ring-line-strongest";
    default:
      return "bg-warn-bg text-medal-bronze ring-1 ring-medal-bronze-line";
  }
}

/** 배지 글자색만 — 게이지·예상 완주 문구처럼 배경 없이 쓰는 자리 */
export function badgeText(badge: string): string {
  return badge === "gold"
    ? "text-gold"
    : badge === "silver"
      ? "text-medal-silver"
      : "text-medal-bronze";
}

/**
 * "골드 <22:00 · 실버 <26:00 · 브론즈 26:00 이상" — 세 등급을 다 적는다.
 * 골드·실버만 적어 두면 "둘 다 못 넘으면 뭐가 되나"가 화면 어디에도 안 나온다
 * (2026-09-14 피드백). 브론즈는 실버 컷오프 이상 전부다(scaled 도 브론즈).
 */
export function badgeScale(
  t: (key: DictKey) => string,
  cuts: { gold: number; silver: number },
  fmt: (ms: number) => string,
): string {
  return [
    `${t("pft.badge.gold")} <${fmt(cuts.gold)}`,
    `${t("pft.badge.silver")} <${fmt(cuts.silver)}`,
    `${t("pft.badge.bronze")} ${fmt(cuts.silver)}+`,
  ].join(" · ");
}

/** 나이 기준 컷오프 — badgeScale 안내에 쓴다 */
export function cutoffsFor(age: number | null | undefined) {
  return age != null && age >= 45 ? PFT_CUTOFFS.over45 : PFT_CUTOFFS.under45;
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
