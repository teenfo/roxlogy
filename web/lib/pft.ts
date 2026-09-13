import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * PFT 6종목 — 순서 고정, 쉬는 시간 없이 연속. 총 시간이 점수다.
 * 공식 종목표(2026-09-14 확인): 1000m 런 → 버피 브로드 점프 50 → 스테이셔너리 런지 100
 * → 1000m 런 → 핸드 릴리즈 푸시업 30 → 덤벨 스러스터 100.
 *
 * **col 이름은 옛 이름 그대로다.** 4번은 `row_ms`, 6번은 `wallball_ms` 인데, 처음 만들 때
 * 4번을 로우·6번을 월볼로 잘못 적어 두었기 때문이다. PFT 는 순서가 고정이라 "4번째 구간의
 * 시간"이라는 의미는 그대로여서 저장된 값은 전부 유효하다. 컬럼을 바꾸면 RPC 반환 모양이
 * 달라져 배포와 원자적이지 않으므로(CLAUDE.md) 이름만 두고 표시를 고쳤다.
 */
export const PFT_STATIONS = [
  { key: "run1", col: "run_ms", label: "pft.st.run1", spec: "pft.spec.run1", amount: "pft.amount.run1", detail: "pft.detail.run1" },
  { key: "burpee", col: "burpee_ms", label: "pft.st.burpee", spec: "pft.spec.burpee", amount: "pft.amount.burpee", detail: "pft.detail.burpee" },
  { key: "lunge", col: "lunge_ms", label: "pft.st.lunge", spec: "pft.spec.lunge", amount: "pft.amount.lunge", detail: "pft.detail.lunge" },
  { key: "run2", col: "row_ms", label: "pft.st.run2", spec: "pft.spec.run2", amount: "pft.amount.run2", detail: "pft.detail.run2" },
  { key: "pushup", col: "pushup_ms", label: "pft.st.pushup", spec: "pft.spec.pushup", amount: "pft.amount.pushup", detail: "pft.detail.pushup" },
  { key: "thruster", col: "wallball_ms", label: "pft.st.thruster", spec: "pft.spec.thruster", amount: "pft.amount.thruster", detail: "pft.detail.thruster" },
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
  // 런이 두 번이라 같은 계열의 파랑 두 단계를 쓴다 — 같은 종목이라는 게 보이되 구분은 된다
  run1: "#7dd3fc",
  burpee: "#e0c53a",
  lunge: "#b5e48c",
  run2: "#38bdf8",
  pushup: "#f4a261",
  thruster: "#e0aaff",
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
      return "bg-[#2a2500] text-accent ring-1 ring-line-accent";
    case "silver":
      return "bg-[#2a2a2a] text-[#d9d9d9] ring-1 ring-[#444]";
    default:
      return "bg-[#2a1a10] text-[#c98150] ring-1 ring-[#6b3f22]";
  }
}

/** 배지 글자색만 — 게이지·예상 완주 문구처럼 배경 없이 쓰는 자리 */
export function badgeText(badge: string): string {
  return badge === "gold"
    ? "text-accent"
    : badge === "silver"
      ? "text-[#d9d9d9]"
      : "text-[#c98150]";
}

/** 나이 기준 컷오프 — "골드 <22:00 · 실버 <26:00" 안내에 쓴다 */
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
