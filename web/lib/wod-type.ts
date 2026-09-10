import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * WOD 유형 색 (2026-09 훈련 화면 핸드오프).
 *
 * 주간 일정·프로그램 카드·WOD 상세가 같은 색으로 유형을 가리켜야 목록에서
 * 상세로 넘어가도 같은 것을 보고 있다는 게 이어진다.
 */
export const WOD_TYPES = ["run", "strength", "wod", "race_sim"] as const;
export type WodType = (typeof WOD_TYPES)[number];

const STYLE: Record<string, { chip: string; dot: string }> = {
  run: { chip: "bg-info-bg text-info", dot: "bg-info" },
  strength: { chip: "bg-[#2a2500] text-accent-dim", dot: "bg-accent-dim" },
  wod: { chip: "bg-success-bg text-success", dot: "bg-success" },
  race_sim: { chip: "bg-accent/15 text-accent", dot: "bg-accent" },
};
const FALLBACK = { chip: "bg-line text-foreground/75", dot: "bg-muted" };

export const wodTypeChip = (type: string | null | undefined) =>
  (type && STYLE[type]) ? STYLE[type].chip : FALLBACK.chip;

export const wodTypeDot = (type: string | null | undefined) =>
  (type && STYLE[type]) ? STYLE[type].dot : FALLBACK.dot;

/** i18n 키 — 사전에 없으면 dictLabel 이 원문으로 떨어뜨린다 */
export const wodTypeKey = (type: string) => `programs.type.${type}` as DictKey;
