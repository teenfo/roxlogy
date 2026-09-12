"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { InitialAvatar } from "@/components/ui/settings-ui";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

const SECTIONS: { id: string; label: DictKey }[] = [
  { id: "profile", label: "profile.secProfile" },
  { id: "account", label: "profile.secAccount" },
  { id: "integrations", label: "profile.secIntegrations" },
  { id: "notifications", label: "notif.title" },
];

/**
 * 스크롤 위치에 따른 현재 섹션. 화면에 걸친 것 중 가장 위를 고른다 —
 * rootMargin 으로 상단 고정 바(52 + 칩 바) 높이만큼 판정선을 내린다.
 */
function useActiveSection(): string {
  const [active, setActive] = useState(SECTIONS[0].id);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (seen) setActive(seen.target.id);
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return active;
}

/** 데스크톱 좌측 고정 목차 (아바타 + 링크 4개 + 언어 카드) */
export function SettingsNav({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const { t } = useI18n();
  const active = useActiveSection();

  return (
    <aside className="sticky top-20 flex flex-col gap-[18px] max-md:hidden">
      <div className="flex min-w-0 items-center gap-3">
        <InitialAvatar name={name} size={48} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-extrabold">{name}</p>
          <p className="truncate text-xs text-muted">{email}</p>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {SECTIONS.map((s) => {
          const on = active === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={on ? "true" : undefined}
              className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
                on
                  ? "bg-card-hover font-bold text-foreground"
                  : "text-muted hover:bg-card-hover"
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${on ? "bg-accent" : "bg-transparent"}`}
              />
              {t(s.label)}
            </a>
          );
        })}
      </nav>

      <div className="rounded-[10px] border border-line bg-card px-3.5 py-3">
        <p className="text-xs text-muted">{t("profile.language")}</p>
        <div className="mt-2">
          <LocaleSwitcher compact />
        </div>
        <p className="mt-2 text-xs text-muted/80">
          {t("profile.languageDesc")}
        </p>
      </div>
    </aside>
  );
}

/** 모바일 상단 고정 섹션 칩 — 목차 대신. 항목이 4개라 가로 스크롤이 거의 없다 */
export function SettingsChips() {
  const { t } = useI18n();
  const active = useActiveSection();

  return (
    <div className="sticky top-[52px] z-30 -mx-4 border-b border-line-soft bg-page px-4 py-2.5 md:hidden">
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map((s) => {
          const on = active === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                on
                  ? "bg-accent text-background"
                  : "border border-line-strong text-muted"
              }`}
            >
              {t(s.label)}
            </a>
          );
        })}
      </div>
    </div>
  );
}
