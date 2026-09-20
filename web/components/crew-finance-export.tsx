"use client";

import { useI18n } from "@/components/i18n-provider";

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
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const body = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    // 엑셀이 UTF-8 로 읽게 BOM 을 붙인다 — 없으면 한글이 깨진다
    const url = URL.createObjectURL(
      new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <button
      type="button"
      onClick={run}
      title={t("crew.finExportNote")}
      className="h-9 shrink-0 rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold hover:border-line-strong"
    >
      ↓ {t("crew.finExport")}
    </button>
  );
}
