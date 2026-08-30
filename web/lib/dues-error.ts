import type { DictKey } from "./i18n/dictionaries/en";

type TFn = (key: DictKey, params?: Record<string, string | number>) => string;

/** set_dues_paid 는 로케일 중립 코드를 던진다 — 화면에서 사전으로 번역한다.
 *  (예전에는 한국어 예외 문장이 그대로 en/es UI 에 노출됐다) */
const KEYS: Record<string, DictKey> = {
  dues_not_staff: "crew.errDuesNotStaff",
  dues_bad_period: "crew.errDuesPeriod",
  dues_bad_amount: "crew.errDuesAmount",
};

export function duesErrText(t: TFn, message: string): string {
  for (const [code, key] of Object.entries(KEYS)) {
    if (message.includes(code)) return t(key);
  }
  return message;
}
