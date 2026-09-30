"use client";

import { useI18n } from "@/components/i18n-provider";
import { Chip } from "@/components/rox/ui";
import { formatLabel, type RaceFormat } from "@/lib/race-format";

export function RaceFormatChip({ format, checkpoints }: { format?: RaceFormat | string | null; checkpoints?: number | null }) {
  const { t } = useI18n();
  if (format !== "hyrox_sim") return null;
  return <Chip tone="blue">{formatLabel(t, "hyrox_sim", checkpoints)}</Chip>;
}
