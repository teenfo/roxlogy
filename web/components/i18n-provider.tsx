"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_TAG,
  type Locale,
} from "@/lib/i18n/config";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

type Dict = Record<string, string>;

type Ctx = {
  locale: Locale;
  tag: string;
  t: (key: DictKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx | null>(null);

/** 쿠키에서 로케일을 읽는다 — 서버가 아니라 브라우저에서. */
function cookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]*)/)?.[1];
  if (!raw) return null;
  try {
    const v = decodeURIComponent(raw);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** 기본 로케일이 아닌 사전만 필요할 때 받아 온다(번들을 로케일별로 쪼갠다). */
async function loadDict(locale: Locale): Promise<Dict> {
  switch (locale) {
    case "ko":
      return (await import("@/lib/i18n/dictionaries/ko")).default;
    case "es":
      return (await import("@/lib/i18n/dictionaries/es")).default;
    default:
      return (await import("@/lib/i18n/dictionaries/en")).default;
  }
}

/**
 * 클라이언트 번역 공급자.
 *
 * 서버는 **항상 기본 로케일(en)** 사전을 넘긴다. 루트 레이아웃이 정적 셸이 되려면
 * 쿠키를 읽을 수 없기 때문이다(cacheComponents/PPR). 그래서 사용자의 실제 로케일은
 * 브라우저에서 보정한다: 하이드레이션 뒤 쿠키를 보고 다르면 그 사전만 동적으로 받아
 * 교체하고 `<html lang>` 도 함께 고친다.
 *
 * 첫 렌더는 서버가 준 사전 그대로라 하이드레이션 불일치가 나지 않는다.
 * 서버 컴포넌트의 텍스트는 여전히 `getT()`(쿠키)로 사용자의 언어로 렌더된다 —
 * 여기서 보정하는 것은 클라이언트 컴포넌트의 텍스트뿐이다.
 */
export function I18nProvider({
  locale: initialLocale,
  dict: initialDict,
  children,
}: {
  locale: Locale;
  dict: Record<string, string>;
  children: React.ReactNode;
}) {
  const [{ locale, dict }, set] = useState<{ locale: Locale; dict: Dict }>({
    locale: initialLocale,
    dict: initialDict,
  });

  useEffect(() => {
    const want = cookieLocale() ?? DEFAULT_LOCALE;
    if (want === locale) return;
    let alive = true;
    loadDict(want)
      .then((d) => {
        if (alive) set({ locale: want, dict: d });
      })
      .catch(() => {
        // 사전을 못 받아도 기본 로케일로 계속 보인다 — 화면이 비지는 않는다
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  // 문서 언어도 맞춰 준다 — 정적 셸은 기본 로케일로 나간다
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

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
