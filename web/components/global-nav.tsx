"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { NavIcon } from "@/components/nav-icon";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Dialog } from "@/components/ui/dialog";
import { NAV, PUBLIC_NAV, type NavItem } from "@/lib/nav";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

type NavigationLink = Pick<NavItem, "href" | "label" | "icon">;
const training = NAV.find((item) => item.key === "training")!.children!;
const racing = NAV.find((item) => item.key === "race")!.children!;
const groups: { label: DictKey; items: NavigationLink[] }[] = [
  { label: "renewal.activity", items: [
    { href: "/dashboard", label: "nav.dashboard", icon: "gauge" },
    NAV[0], ...training,
    { href: "/insights", label: "nav.insights", icon: "rank" },
  ] },
  { label: "nav.grpRace", items: racing },
  { label: "renewal.community", items: [
    ...NAV.filter((item) => item.key === "crews" || item.key === "feed"),
    { href: "/members", label: "nav.members", icon: "crews" },
  ] },
];

/** The desktop shell and mobile drawer share the real application navigation. */
export function GlobalNav({ isAdmin = false, displayName, unread = 0, loginNext }: {
  isAdmin?: boolean; displayName?: string | null; unread?: number; loginNext?: string;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const loggedIn = !!displayName;
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const drawer = drawerAt === pathname;
  const menu = menuAt === pathname;
  const account = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!account.current?.contains(event.target as Node)) setMenuAt(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuAt(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [menu]);
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const current = [...groups.flatMap((g) => g.items),
    { href: "/settings", label: "nav.profile" as DictKey },
    { href: "/admin", label: "nav.admin" as DictKey },
    { href: "/notifications", label: "nav.notifications" as DictKey },
    { href: "/search", label: "nav.search" as DictKey },
  ].find((item) => matches(item.href));
  const brand = (
    <Link href={loggedIn ? "/dashboard" : "/"} className="rx-brand" aria-label="ROXLOGY">
      <Image src="/roxlogy-mark-inverse.svg" alt="" width={36} height={36} priority />
      <span>ROXLOGY</span>
    </Link>
  );
  const navigation = (
    <>
      <div className="rx-sidebar-brand">{brand}</div>
      <nav className="rx-sidebar-links" aria-label={t("renewal.navigation")}>
        {groups.map((group) => (
          <div className="rx-nav-group" key={group.label}>
            <p className="rx-nav-label">{t(group.label)}</p>
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} aria-current={matches(item.href) ? "page" : undefined} className="rx-nav-link">
                <NavIcon name={item.icon} /><span>{t(item.label)}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="rx-sidebar-foot">
        {isAdmin && <Link className="rx-nav-link" href="/admin" aria-current={matches("/admin") ? "page" : undefined}><NavIcon name="diamond" /><span>{t("nav.admin")}</span></Link>}
        <Link className="rx-nav-link" href="/settings/profile" aria-current={matches("/settings") ? "page" : undefined}><span className="rx-avatar">{displayName?.trim()[0]?.toUpperCase() ?? "R"}</span><span className="min-w-0"><strong className="block truncate">{displayName}</strong><span className="text-xs text-muted">{t("nav.profile")}</span></span></Link>
      </div>
    </>
  );
  return (
    <div className={loggedIn ? "rx-navigation rx-nav--app" : "rx-navigation rx-nav--public"}>
      <a href="#main-content" className="rx-skip">{t("renewal.skip")}</a>
      {loggedIn && <aside className="rx-sidebar">{navigation}</aside>}
      <div className="rx-topbar">
        {loggedIn ? <>
          <button className="rx-icon-button rx-menu-toggle" type="button" onClick={() => setDrawerAt(pathname)} aria-label={t("nav.menu")} aria-expanded={drawer}><NavIcon name="list" /></button>
          <span className="rx-topbar-title">{current ? t(current.label) : "ROXLOGY"}</span>
        </> : brand}
        {!loggedIn && <nav className="rx-public-links" aria-label={t("renewal.navigation")}>{PUBLIC_NAV.map((item) => <Link key={item.href} href={item.href} aria-current={matches(item.href) ? "page" : undefined}>{t(item.label)}</Link>)}</nav>}
        <div className="rx-topbar-tools">
          {loggedIn && <Link href="/search" className="rx-search" aria-label={t("nav.search")}><NavIcon name="search" /><span>{t("nav.searchPh")}</span></Link>}
          <LocaleSwitcher compact />
          {loggedIn ? <>
            <Link href="/notifications" className="rx-icon-button relative" aria-label={`${t("nav.notifications")}${unread ? ` (${unread})` : ""}`}><NavIcon name="bell" />{unread > 0 && <span className="rx-notification-dot" />}</Link>
            <div className="relative" ref={account}>
              <button type="button" className="rx-avatar" onClick={() => setMenuAt(menu ? null : pathname)} aria-expanded={menu} aria-label={t("nav.profile")}>{displayName?.trim()[0]?.toUpperCase() ?? "R"}</button>
              {menu && <div className="rx-account-menu">
                <Link href="/settings/profile">{t("nav.profile")}</Link>
                {isAdmin && <Link href="/admin">{t("nav.admin")}</Link>}
                <form action="/auth/signout" method="post"><button type="submit">{t("common.logout")}</button></form>
              </div>}
            </div>
          </> : <Link className="rx-primary" href={`/login${loginNext ? `?next=${encodeURIComponent(loginNext)}` : ""}`}>{t("common.login")}</Link>}
        </div>
      </div>
      <Dialog open={drawer} onClose={() => setDrawerAt(null)} label={t("renewal.navigation")} closeLabel={t("common.close")} variant="center" panelClassName="rx-drawer">{navigation}</Dialog>
    </div>
  );
}
