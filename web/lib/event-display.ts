import type { DictKey } from "./i18n/dictionaries/en";

type TFn = (key: DictKey, params?: Record<string, string | number>) => string;

/** race_events 는 표시용 한국어(city·country)와 구조화 값(city_en·country_code)을
 *  함께 보관한다. 화면은 로케일에 맞는 쪽을 고르고, 없으면 있는 쪽으로 폴백한다. */
export type EventPlace = {
  city: string | null;
  city_en?: string | null;
  country: string | null;
  country_code?: string | null;
};

export function eventCity(e: EventPlace, locale: string): string {
  return locale === "ko"
    ? (e.city ?? e.city_en ?? "")
    : (e.city_en ?? e.city ?? "");
}

export function eventCountry(t: TFn, e: EventPlace, locale: string): string {
  if (locale === "ko") return e.country ?? "";
  if (e.country_code) {
    const key = `country.${e.country_code}` as DictKey;
    const label = t(key);
    // 사전에 없으면 t 가 키를 그대로 돌려준다 — 그때는 저장된 이름으로 폴백
    if (label !== key) return label;
  }
  return e.country ?? "";
}

export function eventPlace(t: TFn, e: EventPlace, locale: string): string {
  const city = eventCity(e, locale);
  const country = eventCountry(t, e, locale);
  return [city, country].filter(Boolean).join(", ");
}

/** 일정 미확정 대회의 비고 — '2026년 11월 예정' 같은 한국어 원문 대신
 *  상태(date_status)와 월을 사전으로 조립한다. 구조화 값이 없으면 원문 폴백. */
export function eventDateNote(
  t: TFn,
  e: { date_note: string | null; date_status?: string | null; start_date: string | null },
  tag: string,
): string | null {
  if (!e.date_status) return e.date_note;
  const month = e.start_date
    ? new Date(`${e.start_date}T00:00:00Z`).toLocaleDateString(tag, {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
      })
    : null;
  if (!month) return e.date_note;
  return t(
    e.date_status === "held" ? "events.dateHeld" : "events.dateScheduled",
    { month },
  );
}
