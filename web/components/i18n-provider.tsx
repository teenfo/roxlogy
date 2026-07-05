"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/i18n/config";
import { LOCALE_TAG } from "@/lib/i18n/config";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

type Ctx = {
  locale: Locale;
  tag: string;
  t: (key: DictKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Record<string, string>;
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(
    () => ({
      locale,
      tag: LOCALE_TAG[locale],
      t: (key, params) => {
        let s = dict[key] ?? key;
        if (params)
          for (const [k, v] of Object.entries(params))
            s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
    }),
    [locale, dict],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
