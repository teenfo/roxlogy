"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { dictLabel } from "@/lib/dict-label";
import { downloadCsv } from "@/lib/csv";
import { crewRoleDictKey } from "@/lib/crew-role";
import type { CrewMemberRow } from "@/lib/crew-types";

/**
 * 멤버 탭의 명단 다운로드 — 지금 보이는(등급 필터가 걸린) 명단을 CSV 한 장으로.
 *
 * 화면에 이미 온 crew_roster 행을 그대로 쓴다. 계정 주소는 RPC 가 운영진에게만
 * 내려주므로(그 외 null) 여기서 따로 가리지 않아도 일반 크루원 파일에는 안 들어간다 —
 * 열은 한 명이라도 주소가 있을 때만 붙인다(빈 열이 늘 있으면 "왜 비었지" 가 된다).
 * 운영진용 상세 내보내기(관리 > 멤버)는 따로 있다 — 이건 크루원 누구나 받는 공개 명단이다.
 */
export function CrewRosterDownload({ slug, rows, className = "" }: { slug: string; rows: CrewMemberRow[]; className?: string }) {
  const { t, locale } = useI18n();

  function run() {
    const withEmail = rows.some((r) => !!r.email);
    const head = [
      t("crew.colMember"),
      ...(withEmail ? [t("crew.csvEmail")] : []),
      t("crew.csvRole"),
      t("crew.colTier"),
      t("crew.csvDivision"),
      t("crew.csvInstagram"),
      t("crew.csvJoined"),
      t("crew.colSessions"),
      t("crew.csvAttendAll"),
      t("crew.csvAttendPaid"),
    ];
    const body = rows.map((m) => [
      m.display_name,
      ...(withEmail ? [m.email ?? ""] : []),
      t(crewRoleDictKey(m.role)),
      m.tier_name ?? "",
      m.division ? dictLabel(t, `division.${m.division}`, m.division) : "",
      m.instagram ? `@${m.instagram}` : "",
      // 가입일은 날짜만 — 시각까지 넣으면 엑셀이 시간대를 제멋대로 옮긴다
      m.joined_at.slice(0, 10),
      m.session_count,
      m.attend_count ?? "",
      m.attend_paid_count ?? "",
    ]);
    downloadCsv(`${slug}-roster-${locale}.csv`, head, body);
  }

  return (
    <Button
      variant="outline"
      type="button"
      onClick={run}
      disabled={rows.length === 0}
      title={t("crew.rosterDownloadNote")}
      className={className}
    >
      <Download size={16} /> {t("crew.rosterDownload")}
    </Button>
  );
}

