"use client";

/**
 * 모바일 하단 탭 + 바텀시트 — 시안 mobile-navigation.tsx 그대로 (스펙 §15).
 * 세션 | 트레이닝▾ | (Watch — 앱 안에서만) | 레이스▾ | 크루 | 피드.
 *
 * 시안과 다른 곳: 탭·시트 목록은 lib/nav.ts NAV 에서 읽고(i18n), 앱 판별은
 * 시안의 sessionStorage 미리보기 대신 lib/native.ts 의 브리지로 한다.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import {
  Activity,
  ChevronDown,
  Dumbbell,
  Flag,
  Newspaper,
  Users,
  Watch as WatchIcon,
} from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { NAV } from "@/lib/nav";
import { roxNative } from "@/lib/native";
import { RoxDialog } from "./dialog";

const ICONS: Record<string, typeof Activity> = {
  sessions: Activity,
  training: Dumbbell,
  race: Flag,
  crews: Users,
  feed: Newspaper,
};

export function MobileNavigation() {
  const { t } = useI18n();
  const path = usePathname() || "/";
  const sheetId = useId();
  // 이동하면 시트가 닫힌 것으로 계산되게 경로를 같이 담는다(effect 없이)
  const [groupAt, setGroupAt] = useState<{ key: string; at: string } | null>(null);
  const group = groupAt && groupAt.at === path ? groupAt.key : null;
  // 앱(WebView) 안에서만 Watch 탭 — 브라우저에서만 아는 값이라 외부 스토어로 읽는다
  const native = useSyncExternalStore(
    () => () => {},
    () => roxNative() !== null,
    () => false,
  );
  const active = (href: string) => path === href || path.startsWith(href + "/");
  const groupItem = NAV.find((n) => n.key === group && n.children);

  return (
    <>
      <nav
        className={"rx-mobile-tabs " + (native ? "rx-native-tabs" : "")}
        aria-label={t("nav.menu")}
      >
        {NAV.flatMap((item, i) => {
          const Icon = ICONS[item.key] ?? Activity;
          const here = item.children
            ? item.children.some((c) => active(c.href))
            : active(item.href);
          const tab = item.children ? (
            <button
              key={item.key}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={group === item.key}
              aria-controls={group === item.key ? sheetId : undefined}
              aria-current={here ? "page" : undefined}
              onClick={() => setGroupAt({ key: item.key, at: path })}
            >
              <Icon size={21} />
              <span>
                {t(item.label)}
                <ChevronDown size={10} />
              </span>
            </button>
          ) : (
            <Link
              key={item.key}
              href={item.href}
              aria-current={here ? "page" : undefined}
            >
              <Icon size={21} />
              <span>{t(item.label)}</span>
            </Link>
          );
          // 시안: 세션 · 트레이닝 · [Watch] · 레이스 · 크루 · 피드
          const watch =
            native && i === 2 ? (
              <Link
                key="__watch"
                href="/watch"
                aria-current={active("/watch") ? "page" : undefined}
                onClick={(e) => {
                  const b = roxNative();
                  if (b?.openWatch) {
                    e.preventDefault();
                    b.openWatch();
                  }
                }}
              >
                <WatchIcon size={21} />
                <span>{t("nav.watch")}</span>
              </Link>
            ) : null;
          return watch ? [watch, tab] : [tab];
        })}
      </nav>
      <RoxDialog
        open={!!groupItem}
        onOpenChange={(open) => {
          if (!open) setGroupAt(null);
        }}
        title={groupItem ? t(groupItem.label) : ""}
        kind="sheet"
      >
        <nav id={sheetId} className="rx-more-grid">
          {groupItem?.children?.map((c) => (
            <Link
              href={c.href}
              aria-current={active(c.href) ? "page" : undefined}
              key={c.href}
              onClick={() => setGroupAt(null)}
            >
              {t(c.label)}
            </Link>
          ))}
        </nav>
      </RoxDialog>
    </>
  );
}
