/**
 * 다국어 설정 — 언어 추가 시 이 파일과 dictionaries/에 사전 파일만 추가.
 * 로케일은 쿠키(NEXT_LOCALE) 기반, 기본값 영어.
 */

export const SUPPORTED_LOCALES = ["en", "ko", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
  es: "Español",
};

/** Intl 포맷용 태그 */
export const LOCALE_TAG: Record<Locale, string> = {
  en: "en-US",
  ko: "ko-KR",
  es: "es-ES",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}
