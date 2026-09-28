"use client";

import { useI18n } from "@/components/i18n-provider";
import { downloadCsv } from "@/lib/csv";

/**
 * 회계 내보내기 — 보고 있는 달을 CSV 한 장으로. 브라우저에서 만들어 받는다
 * (서버 라우트를 두면 권한 검사를 한 번 더 써야 하는데, 이 화면에 이미 온 데이터다).
 */
export function CrewFinanceExport({
  filename,
  head,
  rows,
}: {
  filename: string;
  head: string[];
  rows: (string | number)[][];
}) {
  const { t } = useI18n();

  function run() {
    downloadCsv(filename, head, rows);
  }

  return (
    <button
      type="button"
      onClick={run}
      title={t("crew.finExportNote")}
      className="h-9 shrink-0 rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold hover:border-muted/60"
    >
      ↓ {t("crew.finExport")}
    </button>
  );
}
