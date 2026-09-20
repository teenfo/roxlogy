"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Chip, NavTabs, PageHead } from "@/components/rox/ui";

const SECTIONS: [string, DictKey][] = [
  ["", "admin.overviewTitle"],
  ["users", "admin.usersTitle"],
  ["content", "admin.exercisesTitle"],
  ["crews", "admin.crewsTitle"],
  ["races", "admin.racesTitle"],
  ["moderation", "admin.modTitle"],
];

/**
 * 관리자 공통 머리 — 시안 account.tsx Admin() 그대로: PageHead(구역 제목 · 설명 · Chip 관리자) + NavTabs 6.
 * 제목이 경로를 따라가므로 클라이언트에서 pathname 으로 고른다(레이아웃은 경로를 모른다).
 */
export function AdminNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const section = pathname.split("/")[2] ?? "";
  const isUserDetail = section === "users" && !!pathname.split("/")[3];
  const titleKey = isUserDetail ? ("admin.userDetail" as DictKey) : (SECTIONS.find(([s]) => s === section)?.[1] ?? "admin.overviewTitle");
  return (
    <>
      <PageHead title={t(titleKey)} description={t("admin.spaceDesc")} action={<Chip>{t("admin.badge")}</Chip>} />
      <NavTabs
        path={"/admin" + (section ? "/" + section : "")}
        items={SECTIONS.map(([s]) => [s === "" ? t("admin.tabOverview") : t(`admin.tab${s[0].toUpperCase()}${s.slice(1)}` as DictKey), "/admin" + (s ? "/" + s : "")] as [string, string])}
      />
    </>
  );
}
