import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_TAG,
  type Locale,
} from "./config";
import en, { type DictKey } from "./dictionaries/en";
import ko from "./dictionaries/ko";
import es from "./dictionaries/es";

const DICTS: Record<Locale, Record<DictKey, string>> = { en, ko, es };

export type TFunc = (key: DictKey, params?: Record<string, string | number>) => string;

export function makeT(locale: Locale): TFunc {
  const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
  return (key, params) => {
    let s = dict[key] ?? en[key] ?? key;
    if (params)
      for (const [k, v] of Object.entries(params))
        s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function getDict(locale: Locale): Record<DictKey, string> {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}

/** 서버 컴포넌트/라우트 핸들러용 — 쿠키에서 로케일을 읽어 t를 만든다 */
export async function getT(): Promise<{ t: TFunc; locale: Locale; tag: string }> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return { t: makeT(locale), locale, tag: LOCALE_TAG[locale] };
}

export type { DictKey };
