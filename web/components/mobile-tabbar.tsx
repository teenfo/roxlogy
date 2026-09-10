"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n-provider";
import { NAV, activeNavKey } from "@/lib/nav";
import { roxNative } from "@/lib/native";

/**
 * 모바일 하단 탭바 + 서브메뉴 바텀시트 (2026-09 디자인 핸드오프).
 * 햄버거 목록 대신 5개 탭을 항상 노출한다 — 터치 타깃 44px 이상.
 * 서브메뉴가 있는 탭(훈련·레이스)은 이동 대신 시트를 연다.
 */
export function MobileTabBar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  // 이동하면 시트가 닫힌 것으로 계산되게 경로를 함께 담는다
  // (effect 안에서 setState 하지 않기 위한 파생 상태)
  const [sheetAt, setSheetAt] = useState<{ key: string | null; at: string } | null>(
    null,
  );
  const sheet = sheetAt && sheetAt.at === pathname ? sheetAt.key : null;
  const setSheet = (key: string | null) => setSheetAt({ key, at: pathname });

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheetAt(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const openItem = NAV.find((n) => n.key === sheet && n.children);

  // 앱(WebView) 안이면 네이티브 워치 화면으로 가는 탭을 가운데에 끼운다.
  // 앱 v0.7 부터 네이티브 하단 탭바를 걷어내고 이 탭바 하나로 통일했다 —
  // 탭 목록이 두 군데면 한쪽에만 메뉴가 붙는 일이 반복된다(nav.ts 주석).
  // 브라우저에서만 아는 값이라 useSyncExternalStore 로 읽는다 — 서버 스냅샷은
  // null 이라 hydration 이 깨지지 않고, 브리지 메서드는 참조가 고정이라 안정적이다.
  const openWatch = useSyncExternalStore(
    () => () => {},
    () => roxNative()?.openWatch ?? null,
    () => null,
  );
  const cols = openWatch ? "grid-cols-6" : "grid-cols-5";
  const WATCH_AT = 2; // 세션 · 훈련 · [워치] · 레이스 · 크루 · 피드

  return (
    <>
      {/* 시트 */}
      {openItem && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label={t("common.cancel")}
            onClick={() => setSheet(null)}
            className="absolute inset-0 bg-black/55"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-line-mid bg-control px-4 pb-[calc(84px+env(safe-area-inset-bottom))] pt-2.5">
            <span
              aria-hidden
              className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line-strong"
            />
            <p className="text-[11px] font-extrabold tracking-[0.08em] text-accent">
              {t(openItem.label).toUpperCase()}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {openItem.children!.map((c, i) => (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    className="flex items-center gap-3 rounded-xl bg-card p-3.5"
                  >
                    <span
                      aria-hidden
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                        i === 0
                          ? "border border-line-accent bg-highlight text-accent"
                          : "bg-line text-muted"
                      }`}
                    >
                      {c.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">
                        {t(c.label)}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {t(c.desc)}
                      </span>
                    </span>
                    <span aria-hidden className="text-muted">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 하단 탭바 */}
      <nav className={`fixed inset-x-0 bottom-0 z-40 grid ${cols} border-t border-line-soft bg-[var(--nav)] px-2 pb-[env(safe-area-inset-bottom)] pt-2 md:hidden`}>
        {NAV.flatMap((item, i) => {
          const on = active === item.key;
          const watchTab =
            openWatch && i === WATCH_AT ? (
              <button
                key="__watch"
                type="button"
                onClick={() => openWatch()}
                className="flex min-h-11 flex-col items-center justify-center py-1"
              >
                <span
                  aria-hidden
                  className="flex h-[30px] w-11 items-center justify-center rounded-full text-sm text-muted"
                >
                  ⌚
                </span>
                <span className="mt-0.5 text-[11px] text-muted">{t("nav.watch")}</span>
              </button>
            ) : null;
          const inner = (
            <>
              <span
                aria-hidden
                className={`flex h-[30px] w-11 items-center justify-center rounded-full text-sm transition-colors ${
                  on ? "bg-accent text-background" : "text-muted"
                }`}
              >
                {item.icon}
              </span>
              <span
                className={`mt-0.5 text-[11px] ${on ? "font-extrabold text-accent" : "text-muted"}`}
              >
                {t(item.label)}
              </span>
            </>
          );
          const cls = "flex min-h-11 flex-col items-center justify-center py-1";
          const tab = item.children ? (
            <button
              key={item.key}
              type="button"
              onClick={() => setSheet(sheet === item.key ? null : item.key)}
              className={cls}
            >
              {inner}
            </button>
          ) : (
            <Link key={item.key} href={item.href} className={cls}>
              {inner}
            </Link>
          );
          return watchTab ? [watchTab, tab] : [tab];
        })}
      </nav>
    </>
  );
}
