import type { DictKey } from "./i18n/dictionaries/en";

type TFn = (key: DictKey, params?: Record<string, string | number>) => string;

/** start_program / stop_program 은 로케일 중립 코드를 돌려준다 — 화면에서 번역한다. */
const KEYS: Record<string, DictKey> = {
  program_not_found_or_hidden: "programs.errNotVisible",
  program_has_no_days: "programs.errNoDays",
  end_before_start: "programs.errEndBeforeStart",
  no_active_enrollment: "programs.errNoActive",
};

export function enrollErrText(t: TFn, code: string): string {
  return KEYS[code] ? t(KEYS[code]) : code;
}
