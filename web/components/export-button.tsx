"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

type Kind = "sessions" | "races";

/** CSV 한 셀 이스케이프 (쉼표·따옴표·개행 포함 시 큰따옴표로 감쌈) */
function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

export function ExportButton({ kind }: { kind: Kind }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const supabase = createClient();
    let csv = "";
    if (kind === "sessions") {
      const { data } = await supabase
        .from("sessions")
        .select("id, started_at, total_time_ms, source_device, rpe, notes")
        .is("deleted_at", null)
        .order("started_at", { ascending: false });
      csv = toCsv(
        ["id", "started_at", "total_time_ms", "source", "rpe", "notes"],
        (data ?? []).map((s) => [
          s.id,
          s.started_at,
          s.total_time_ms,
          s.source_device,
          s.rpe ?? "",
          s.notes ?? "",
        ]),
      );
    } else {
      const { data } = await supabase
        .from("race_results")
        .select("id, event, event_date, division, total_time_ms")
        .order("event_date", { ascending: false });
      csv = toCsv(
        ["id", "event", "event_date", "division", "total_time_ms"],
        (data ?? []).map((r) => [
          r.id,
          r.event,
          r.event_date ?? "",
          r.division ?? "",
          r.total_time_ms,
        ]),
      );
    }

    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roxlogy-${kind}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      className="rounded-md border border-muted/40 px-3 py-1.5 text-xs text-muted hover:border-foreground hover:text-foreground disabled:opacity-40"
    >
      {busy ? t("common.saving") : t("common.exportCsv")}
    </button>
  );
}
