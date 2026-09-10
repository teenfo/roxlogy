"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { NAV, PUBLIC_NAV, activeNavKey, type NavItem } from "@/lib/nav";

/**
 * 글로벌 네비게이션 (2026-09 디자인 핸드오프).
 * 데스크톱·태블릿은 필 탭, 모바일은 상단 바 + 하단 탭바(별도 컴포넌트).
 * 메뉴 목록은 lib/nav.ts 한 곳에서만 읽는다.
 */
export function GlobalNav({
  isAdmin = false,
  displayName,
  unread = 0,
  loginNext,
}: {
  isAdmin?: boolean;
  /** 없으면 비로그인 — 검색만 남기고 로그인 버튼을 보여준다 */
  displayName?: string | null;
  unread?: number;
  loginNext?: string;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  // 비로그인은 공개 페이지만 — NAV 를 그대로 쓰면 탭 다섯 개가 전부
  // /login 리다이렉트로 끝난다.
  const loggedIn = !!displayName;
  const items = loggedIn ? NAV : PUBLIC_NAV;
  const active = activeNavKey(pathname, items);
  // 열림 상태에 "어느 경로에서 열었는지"를 같이 담는다. 이동하면 자동으로
  // 닫힌 것으로 계산된다 — effect 안에서 setState 하지 않기 위한 파생 상태.
  const [openAt, setOpenAt] = useState<{ key: string | null; at: string } | null>(
    null,
  );
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const open = openAt && openAt.at === pathname ? openAt.key : null;
  const menu = menuAt === pathname;
  const setOpen = (key: string | null) => setOpenAt({ key, at: pathname });
  const setMenu = (v: boolean) => setMenuAt(v ? pathname : null);
  const wrap = useRef<HTMLDivElement>(null);

  // 바깥 클릭·ESC 로 닫는다
  useEffect(() => {
    if (!open && !menu) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpenAt(null);
        setMenuAt(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenAt(null);
        setMenuAt(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, menu]);

  const currentLabel = items.find((n) => n.key === active)?.label;

  const pill = (item: NavItem) => {
    const on = active === item.key;
    const cls = `flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm transition-colors max-md:h-8 max-md:px-2.5 max-md:text-xs ${
      on
        ? "bg-accent font-extrabold text-background"
        : open === item.key
          ? "bg-line text-foreground"
          : "text-foreground/70 hover:bg-line hover:text-foreground"
    }`;
    if (!item.children) {
      return (
        <Link key={item.key} href={item.href} className={cls}>
          {t(item.label)}
        </Link>
      );
    }
    return (
      <button
        key={item.key}
        type="button"
        aria-expanded={open === item.key}
        onClick={() => setOpen(open === item.key ? null : item.key)}
        className={cls}
      >
        {t(item.label)}
        <span
          aria-hidden
          className={`text-[9px] ${open === item.key ? "text-accent" : "text-muted"}`}
        >
          {open === item.key ? "▲" : "▼"}
        </span>
      </button>
    );
  };

  const openItem = items.find((n) => n.key === open && n.children);

  return (
    <div ref={wrap} className="relative">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-6 max-md:h-[52px] max-md:px-4">
        {/* 로고 — 기존 마크를 그대로 쓴다 */}
        <Link
          href={loggedIn ? "/dashboard" : "/"}
          className="flex shrink-0 items-center gap-2.5"
        >
          <Image
            src="/roxlogy-mark.svg"
            alt="Roxlogy"
            width={30}
            height={30}
            className="max-md:h-7 max-md:w-7"
          />
          <span className="text-[17px] font-extrabold tracking-[0.08em] max-lg:hidden">
            ROXLOGY
          </span>
        </Link>

        {/* 모바일: 현재 섹션명 (비로그인은 그 자리에 공개 탭을 그린다) */}
        {loggedIn && currentLabel && (
          <span className="text-[17px] font-extrabold md:hidden">
            {t(currentLabel)}
          </span>
        )}

        {/* 필 탭 — 비로그인은 항목이 3개뿐이라 모바일에서도 그대로 보인다.
            로그인 상태의 5개는 좁은 화면에 안 들어가 하단 탭바로 간다. */}
        <nav
          className={`mx-auto items-center gap-1 rounded-full border border-line-mid bg-control p-1 ${
            loggedIn
              ? "hidden md:flex"
              : // 긴 로케일(es)에서도 페이지가 가로로 밀리지 않도록, 넘치면
                // 필 바 안에서만 스크롤시킨다.
                "flex min-w-0 max-md:gap-0.5 max-md:overflow-x-auto max-md:p-0.5 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden"
          }`}
        >
          {items.map(pill)}
        </nav>

        {/* 우측 유틸 */}
        <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
          {/* 검색은 (app) 그룹이라 비로그인이 누르면 로그인으로 튕긴다 */}
          {loggedIn && (
            <Link
              href="/search"
              aria-label={t("nav.search")}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line-mid bg-control text-muted transition-colors hover:text-foreground lg:h-9 lg:w-auto lg:px-4"
            >
              <span aria-hidden>⌕</span>
              <span className="ml-2 hidden text-[13px] lg:inline">
                {t("nav.searchPh")}
              </span>
            </Link>
          )}

          {displayName ? (
            <>
              <Link
                href="/notifications"
                aria-label={t("nav.notifications")}
                className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line-mid bg-control text-muted transition-colors hover:text-foreground"
              >
                <span aria-hidden>◔</span>
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--nav)] bg-sunday" />
                )}
              </Link>

              {/* 아바타 메뉴 — 프로필·관리자·로그아웃을 여기로 모았다 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenu(!menu)}
                  aria-expanded={menu}
                  aria-label={t("nav.menu")}
                  className={`flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-background ${
                    isAdmin
                      ? "ring-2 ring-line-accent ring-offset-2 ring-offset-[var(--nav)]"
                      : ""
                  }`}
                >
                  {(displayName.trim()[0] ?? "?").toUpperCase()}
                </button>
                {menu && (
                  <div className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-xl border border-line-mid bg-control shadow-[0_16px_40px_rgba(0,0,0,.5)]">
                    <Link
                      href="/settings/profile"
                      className="block px-4 py-2.5 text-sm hover:bg-card-hover"
                    >
                      {t("nav.profile")}
                    </Link>
                    {isAdmin && (
                      <Link
                        href="/admin"
                        className="block px-4 py-2.5 text-sm font-semibold text-accent hover:bg-card-hover"
                      >
                        {t("nav.admin")}
                      </Link>
                    )}
                    <form action="/auth/signout" method="post">
                      <button
                        type="submit"
                        className="block w-full px-4 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground"
                      >
                        {t("common.logout")}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link
              href={`/login${loginNext ? `?next=${encodeURIComponent(loginNext)}` : ""}`}
              className="flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-bold text-background hover:brightness-110"
            >
              {t("common.login")}
            </Link>
          )}
        </div>
      </div>

      {/* 서브메뉴 드롭다운 (데스크톱·태블릿) */}
      {openItem && (
        <div className="absolute left-1/2 top-[58px] z-50 hidden w-[min(640px,calc(100vw-3rem))] -translate-x-1/2 rounded-2xl border border-line-mid bg-control p-4 shadow-[0_16px_40px_rgba(0,0,0,.5)] md:block">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {openItem.children!.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="rounded-xl bg-card p-3.5 transition-colors hover:bg-card-hover"
              >
                <span aria-hidden className="text-base text-accent">
                  {c.icon}
                </span>
                <p className="mt-1 text-[15px] font-bold">{t(c.label)}</p>
                <p className="mt-0.5 text-xs text-muted">{t(c.desc)}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
