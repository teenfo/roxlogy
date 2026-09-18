import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * 크루 장부 거래 분류 (마이그레이션 106).
 *
 * DB 에는 영어 키로 저장하고 화면에서 번역한다 — 크루가 쓰는 언어가 섞여도 집계가
 * 갈라지지 않는다. 종류마다 쓸 수 있는 키가 달라서 DB 체크 제약도 짝을 본다:
 * 여기 목록을 늘리면 마이그레이션도 같이 늘려야 한다.
 */
export const LEDGER_CATEGORIES = {
  income: ["dues_monthly", "dues_session", "dues_other", "sponsor", "carryover"],
  expense: ["venue", "snack", "gear", "race", "other"],
} as const;

export type LedgerKind = keyof typeof LEDGER_CATEGORIES;
export type LedgerCategory =
  | (typeof LEDGER_CATEGORIES)["income"][number]
  | (typeof LEDGER_CATEGORIES)["expense"][number];

export function isValidCategory(kind: LedgerKind, value: string): boolean {
  return (LEDGER_CATEGORIES[kind] as readonly string[]).includes(value);
}

export function categoryDictKey(category: string): DictKey {
  return `crew.finCat.${category}` as DictKey;
}

/**
 * 행 배지 색. 회비는 딤 옐로, 나머지 지출은 주황, 나머지 수입은 하늘색 —
 * 카테고리마다 다른 색을 주면 표가 알록달록해져 오히려 안 읽힌다.
 * 색으로 나누는 건 지출 구성 바 하나뿐이다.
 */
/** 회비 분류(월회비·회차비·기타 회비)는 다 같은 딤 옐로다 */
export function isDuesCategory(category: string | null | undefined): boolean {
  return category != null && category.startsWith("dues");
}

export function categoryBadgeClass(kind: string, category: string | null): string {
  if (isDuesCategory(category)) return "bg-gold-bg text-accent-dim";
  return kind === "income" ? "bg-info-bg text-info" : "bg-warn-bg text-warn";
}

/** 지출 구성 바 — 카테고리 순서대로 돌린다(색이 고정이라 달이 바뀌어도 같은 색) */
export const EXPENSE_BAR_COLORS: Record<string, string> = {
  venue: "var(--warn)",
  snack: "var(--cat-sky)",
  gear: "var(--cat-violet)",
  race: "var(--cat-lime)",
  other: "var(--cat-pink)",
  /** 분류를 고르지 않은 옛 행 */
  none: "var(--muted-3)",
};
