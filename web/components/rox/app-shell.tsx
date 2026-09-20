"use client";

/**
 * 앱 셸 — 시안 roxlogy-renewal/source/components/rox/rox-app.tsx 의 AppShell 그대로.
 * docs/design/PORT_PLAN.md §2.
 *
 * 사이드바(15.5rem · 3그룹 14항목 · 푸터에 내 크루+프로필) · 상단바(트리거 ·
 * MY WORKSPACE · 언어 · 검색 · 알림 · 아바타) · .rx-main · .rx-footer · 모바일 하단 탭.
 *
 * 시안과 다른 곳(브랜드 예외·실데이터뿐):
 *   - .rx-brand 는 노란 사각 "R." 대신 링 마크 img (PORT_PLAN §1-b)
 *   - 메뉴 항목·라벨은 lib/nav.ts NAV_GROUPS + i18n (시안은 한국어 하드코딩)
 *   - 푸터 크루·프로필은 실데이터. 크루가 없으면 "크루 찾기"
 *   - 알림 아이콘에 미확인 점(시안에는 없다 — 기능 유지용 최소 추가)
 *   - 시안의 미리보기 태그(.rx-preview-tag)는 넣지 않는다
 */
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  ChevronRight,
  Dumbbell,
  Flag,
  LayoutDashboard,
  Search,
  Target,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/components/i18n-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NAV_GROUPS, activeNavHref } from "@/lib/nav";
import type { ShellCrew } from "@/lib/shell";
import { crewInitials } from "@/lib/crew-types";
import { MobileNavigation } from "./mobile-navigation";

/** 시안 rox-app.tsx 의 아이콘 배정 — href 기준 */
const ICONS: Record<string, typeof Activity> = {
  "/dashboard": LayoutDashboard,
  "/sessions": Activity,
  "/races": Flag,
  "/goals": Target,
  "/insights": Activity,
  "/schedule": CalendarDays,
  "/programs": Dumbbell,
  "/runs": Zap,
  "/exercises": Dumbbell,
  "/pft": Activity,
  "/events": CalendarDays,
  "/crews": Users,
  "/leaderboard": Trophy,
  "/feed": Activity,
};

export function AppShell({
  displayName,
  crew,
  unread,
  children,
}: {
  displayName: string;
  crew: ShellCrew | null;
  unread: number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const path = usePathname() || "/dashboard";
  const active = activeNavHref(path);
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}
    >
      <a href="#main-content" className="rx-skip">
        {t("a11y.skipContent")}
      </a>
      <Sidebar className="rx-sidebar">
        <SidebarHeader>
          <Link className="rx-brand" href="/dashboard">
            <Image src="/roxlogy-appicon.svg" alt="" width={35} height={35} />
            <strong>ROXLOGY</strong>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {NAV_GROUPS.map((g) => (
            <SidebarGroup key={g.key}>
              <SidebarGroupLabel>{t(g.label)}</SidebarGroupLabel>
              <SidebarMenu>
                {g.items.map((it) => {
                  const Icon = ICONS[it.href] ?? Activity;
                  return (
                    <SidebarMenuItem key={it.href}>
                      <SidebarMenuButton asChild isActive={active === it.href}>
                        <NavItemLink href={it.href}>
                          <Icon />
                          <span>{t(it.label)}</span>
                        </NavItemLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          {crew ? (
            <Link className="rx-crew-link" href={`/crews/${crew.slug}`}>
              <span className="rx-crew-mark">
                {crew.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={crew.logo_url} alt="" />
                ) : (
                  crewInitials(crew.name)
                )}
              </span>
              <span>
                <b>{crew.name}</b>
                <small>
                  {t("shell.myCrew")}
                  {crew.location ? ` · ${crew.location}` : ""}
                </small>
              </span>
              <ChevronRight size={16} />
            </Link>
          ) : (
            <Link className="rx-crew-link" href="/crews">
              <span className="rx-crew-mark">
                <Users size={16} />
              </span>
              <span>
                <b>{t("shell.findCrew")}</b>
                <small>{t("shell.myCrew")}</small>
              </span>
              <ChevronRight size={16} />
            </Link>
          )}
          <Link className="rx-profile" href="/settings/profile">
            <span className="rx-avatar">{initial}</span>
            <span>
              <b>{displayName}</b>
              <small>{t("shell.profileSettings")}</small>
            </span>
          </Link>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="rx-shell">
        <header className="rx-topbar">
          <div className="rx-top-left">
            <SidebarTrigger aria-label={t("nav.menu")} />
            <span>MY WORKSPACE</span>
          </div>
          <div className="rx-top-actions">
            <LocaleSwitcher className="rx-locale" />
            <Link aria-label={t("nav.search")} href="/search">
              <Search size={19} />
            </Link>
            <Link aria-label={t("nav.notifications")} href="/notifications">
              <Bell size={19} />
              {unread > 0 && <span className="rx-bell-dot" aria-hidden />}
            </Link>
            <Link className="rx-avatar" href="/settings/profile">
              {initial}
            </Link>
          </div>
        </header>
        <div id="main-content" tabIndex={-1} className="rx-main">
          {children}
        </div>
        <footer className="rx-footer">
          <span>ROXLOGY · THE SCIENCE OF HYBRID RACING</span>
          <span />
        </footer>
      </SidebarInset>
      <MobileNavigation />
      <Toaster richColors />
    </SidebarProvider>
  );
}

function NavItemLink({ onClick, ...props }: React.ComponentProps<typeof Link>) {
  const { setOpenMobile } = useSidebar();
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        setOpenMobile(false);
      }}
    />
  );
}
