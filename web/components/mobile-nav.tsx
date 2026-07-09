"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";

const LINKS: { href: string; key: string }[] = [
  { href: "/dashboard", key: "nav.dashboard" },
  { href: "/sessions", key: "nav.sessions" },
  { href: "/races", key: "nav.races" },
  { href: "/programs", key: "nav.programs" },
  { href: "/schedule", key: "nav.schedule" },
  { href: "/leaderboard", key: "nav.leaderboard" },
  { href: "/feed", key: "nav.feed" },
  { href: "/exercises", key: "nav.exercises" },
  { href: "/predict", key: "nav.predict" },
  { href: "/events", key: "nav.events" },
  { href: "/settings/profile", key: "nav.profile" },
];

export function MobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const links = isAdmin
    ? [...LINKS, { href: "/admin", key: "nav.admin" }]
    : LINKS;

  return (
    <div className="relative ml-auto sm:hidden">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:text-foreground"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <nav className="absolute right-0 z-20 mt-2 flex w-48 flex-col rounded-md border border-surface bg-background py-2 shadow-lg">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm text-muted hover:bg-surface hover:text-foreground"
              >
                {t(l.key as Parameters<typeof t>[0])}
              </Link>
            ))}
            <form action="/auth/signout" method="post" className="border-t border-surface mt-1 pt-1">
              <button
                type="submit"
                className="w-full px-4 py-2 text-left text-sm text-muted hover:bg-surface hover:text-foreground"
              >
                {t("common.logout")}
              </button>
            </form>
          </nav>
        </>
      )}
    </div>
  );
}
