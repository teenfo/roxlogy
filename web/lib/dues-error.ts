import type { DictKey } from "./i18n/dictionaries/en";

type TFn = (key: DictKey, params?: Record<string, string | number>) => string;

/** 크루 RPC 는 로케일 중립 코드를 던진다 — 화면에서 사전으로 번역한다.
 *  (예전에는 한국어 예외 문장이 그대로 en/es UI 에 노출됐다) */
const KEYS: Record<string, DictKey> = {
  dues_not_staff: "crew.errDuesNotStaff",
  dues_bad_period: "crew.errDuesPeriod",
  dues_bad_amount: "crew.errDuesAmount",
  dues_not_owner: "crew.errDuesNotOwner",
  dues_already_confirmed: "crew.errDuesConfirmed",
  dues_waived: "crew.err.dues_waived",
  charge_not_found: "crew.errChargeNotFound",
  event_not_found: "crew.errEventNotFound",
  attend_not_staff: "crew.errAttendNotStaff",
  attend_not_member: "crew.errAttendNotMember",
  crew_not_found: "crew.errCrewNotFound",
  tier_not_found: "crew.errTierNotFound",
  tier_not_staff: "crew.errTierNotStaff",
  tier_is_default: "crew.errTierDefault",
  tier_wrong_crew: "crew.errTierWrongCrew",
};

export function duesErrText(t: TFn, message: string): string {
  for (const [code, key] of Object.entries(KEYS)) {
    if (message.includes(code)) return t(key);
  }
  return message;
}
