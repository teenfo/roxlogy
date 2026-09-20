"use client";

import { Download } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { downloadCSV } from "@/lib/won";

/**
 * 회계 내보내기 — 시안 Finance 의 "내보내기" outline 버튼(Download 아이콘) 그대로.
 * 보고 있는 달을 CSV 한 장으로, 브라우저에서 만들어 받는다
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
  return (
    <Button
      variant="outline"
      type="button"
      onClick={() => downloadCSV(filename, head, rows)}
      title={t("crew.finExportNote")}
    >
      <Download size={16} />
      {t("crew.finExport")}
    </Button>
  );
}
