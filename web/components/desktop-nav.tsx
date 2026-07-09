"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";

type Item = { href: string; key: string };

// 세션·피드는 상시 노출, 나머지는 훈련/레이스 드롭다운으로 묶는다.
const GROUPS: { key: string; items: Item[] }[] = [
  {
    key: "nav.grpTraining",
    items: [
      { href: "/programs", key: "nav.programs" },
      { href: "/schedule", key: "nav.schedule" },
      { href: "/exercises", key: "nav.exercises" },
    ],
  },
  {
    key: "nav.grpRace",
    items: [
      { href: "/races", key: "nav.races" },
      { href: "/events", key: "nav.events" },
      { href: "/predict", key: "nav.predict" },
      { href: "/goals", key: "nav.goals" },
      { href: "/leaderboard", key: "nav.leaderboard" },
    ],
  },
];

export function DesktopNav() {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const linkCls = "text-sm text-muted hover:text-foreground";

  return (
    <div className="hidden items-center gap-6 sm:flex">
      <Link href="/sessions" className={linkCls}>
        {t("nav.sessions")}
      </Link>

      {GROUPS.map((g) => (
        <div key={g.key} className="relative">
          <button
            type="button"
            aria-expanded={open === g.key}
            onClick={() => setOpen(open === g.key ? null : g.key)}
            className={`flex items-center gap-1 ${linkCls}`}
          >
            {t(g.key as Parameters<typeof t>[0])}
            <span className="text-[9px] leading-none">▾</span>
          </button>
          {open === g.key && (
            <>
              <button
                aria-hidden
                tabIndex={-1}
                onClick={() => setOpen(null)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute left-0 z-20 mt-2 flex w-44 flex-col rounded-md border border-surface bg-background py-2 shadow-lg">
                {g.items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(null)}
                    className="px-4 py-2 text-sm text-muted hover:bg-surface hover:text-foreground"
                  >
                    {t(it.key as Parameters<typeof t>[0])}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      <Link href="/feed" className={linkCls}>
        {t("nav.feed")}
      </Link>
    </div>
  );
}
