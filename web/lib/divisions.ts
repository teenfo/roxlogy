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
