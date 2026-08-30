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
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    // 내보내기는 "내 데이터" — shared 세션은 RLS 로 전체 공개라 본인 필터 필수
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }
    let csv = "";
    if (kind === "sessions") {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, started_at, total_time_ms, source_device, rpe, notes")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("started_at", { ascending: false });
      if (error) {
        setBusy(false);
        return setErr(error.message);
      }
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
      const { data, error } = await supabase
        .from("race_results")
        .select("id, event, event_date, division, total_time_ms")
        .eq("user_id", user.id)
        .order("event_date", { ascending: false });
      if (error) {
        setBusy(false);
        return setErr(error.message);
      }
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
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md border border-muted/40 px-3 py-1.5 text-xs text-muted hover:border-foreground hover:text-foreground disabled:opacity-40"
      >
        {busy ? t("common.saving") : t("common.exportCsv")}
      </button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
