"use client";

import { useI18n } from "@/components/i18n-provider";
import { formatLabel, type RaceFormat } from "@/lib/race-format";

/** 레이스 목록의 종목 칩 — 하이록스 시뮬만 붙인다(PFT 가 기본이라 붙이면 소음이다) */
export function RaceFormatChip({ format, checkpoints }: { format?: RaceFormat | string | null; checkpoints?: number | null }) {
  const { t } = useI18n();
  if (format !== "hyrox_sim") return null;
  return (
    <span className="rounded-md bg-info-bg px-2 py-0.5 text-[11px] font-bold text-info">
      {formatLabel(t, "hyrox_sim", checkpoints)}
    </span>
  );
}
