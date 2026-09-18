"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { NavIcon } from "@/components/nav-icon";
import { NAV_GROUPS, activeNavHref } from "@/lib/nav";

/**
 * 데스크톱 좌측 고정 사이드바 (디자인 스펙 1.3 §04).
 *
 * 치수는 스펙 값 그대로다: 폭 248px, 메뉴 높이 41px·글자 14px·좌우 13px·간격 11px,
 * 그룹 라벨 12px/32px, 아이콘 17px, 활성 표시는 굵은 글자 + 왼쪽 3px 인디케이터.
 * 인디케이터 색만 스펙의 #DFC026 대신 브랜드 옐로(--accent)를 쓴다 — 면이라
 * 대비 문제가 없고, "브랜드 자산은 그대로" 대전제를 따른다.
 *
 * 768px 미만에서는 감춘다. 좁은 화면은 하단 탭바(`MobileTabBar`)가 맡는다 —
 * 스펙 §15 가 하단 탭을 필수로 확정했고 그 5개 구성이 우리 것과 같다.
 *
 * `fixed` 인 이유: 크루 라우트는 공유 링크 때문에 (app) 그룹 **밖**에 있어서
 * 같은 레이아웃의 flex 형제로 끼울 수 없다. 대신 본문 쪽에 `md:pl-[248px]` 를
 * 준다(`SIDEBAR_OFFSET`).
 */
export function AppSidebar() {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const active = activeNavHref(pathname);

  return (
    <aside className="fixed left-0 top-0 z-50 hidden h-dvh w-[248px] flex-col overflow-y-auto border-r border-line bg-nav md:flex">
      <Link
        href="/dashboard"
        className="flex items-center gap-[11px] px-6 pb-[22px] pt-[29px]"
      >
        <Image src="/roxlogy-appicon.svg" alt="Roxlogy" width={35} height={35} />
        <strong className="text-[20px] font-extrabold tracking-[0.06em]">
          ROXLOGY
        </strong>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-4 pb-4">
        {NAV_GROUPS.map((g) => (
          <div key={g.key} className="py-2">
            <p className="flex h-8 items-center pl-[13px] text-xs tracking-[0.5px] text-muted-3">
              {t(g.label)}
            </p>
            {g.items.map((it) => {
              const on = active === it.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-[41px] items-center gap-[11px] rounded-[7px] px-[13px] text-sm transition-colors ${
                    on
                      ? "bg-highlight font-bold text-foreground shadow-[inset_3px_0_var(--accent)]"
                      : "text-muted hover:bg-card-hover hover:text-foreground"
                  }`}
                >
                  <NavIcon name={it.icon} className="h-[17px] w-[17px]" />
                  {t(it.label)}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

/** 사이드바가 있는 화면의 본문 왼쪽 여백 */
export const SIDEBAR_OFFSET = "md:pl-[248px]";
