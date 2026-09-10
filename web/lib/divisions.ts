// HYROX 디비전 목록 (단일 출처). i18n 키는 division.<value>.
// 믹스 더블 / 믹스 릴레이 포함. sessions.division 제약과 동일하게 유지할 것.
export const DIVISIONS = [
  "open",
  "pro",
  "doubles",
  "mixed_doubles",
  "pro_doubles",
  "relay",
  "mixed_relay",
] as const;

export type Division = (typeof DIVISIONS)[number];

/** 두 명 이상이 함께 뛰는 디비전 — 파트너 초대가 열린다 */
export const DOUBLES_DIVISIONS = [
  "doubles",
  "mixed_doubles",
  "pro_doubles",
  "relay",
  "mixed_relay",
] as const;
