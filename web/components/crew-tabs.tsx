"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type CrewTab = { href: string; label: string; badge?: number };

/**
 * 크루 탭 바. 지금까지 활성 탭 표시가 없어서 어느 탭에 있는지 알 수 없었다 —
 * 현재 경로와 대조해 옐로 언더라인을 붙인다.
 *
 * 소개 탭(`/crews/[slug]`)은 다른 탭들의 접두사라 정확히 일치할 때만 활성으로 본다.
 */
export function CrewTabs({ tabs }: { tabs: CrewTab[] }) {
  const pathname = usePathname();
  const base = tabs[0]?.href ?? "";

  return (
    <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line pb-px">
      {tabs.map((tab) => {
        const active =
          tab.href === base
            ? pathname === base
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[15px] transition-colors ${
              active
                ? "border-accent font-bold text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {!!tab.badge && (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-background">
                {tab.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
