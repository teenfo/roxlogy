"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { DIVISIONS } from "@/lib/divisions";
import { formatMs, parseTimeToMs } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 레이스 결과의 기본 정보 수정 — 대회명·날짜·디비전·총기록·BIB.
 *  스플릿(구간 기록)은 재등록 없이 유지된다. race_results 는 own RLS. */
export function RaceEditForm({
  raceId,
  event,
  eventDate,
  division,
  totalMs,
  bib,
}: {
  raceId: string;
  event: string;
  eventDate: string | null;
  division: string | null;
  totalMs: number | null;
  bib: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [eEvent, setEEvent] = useState(event);
  const [eDate, setEDate] = useState(eventDate ?? "");
  const [eDiv, setEDiv] = useState(division ?? "");
  const [eTotal, setETotal] = useState(totalMs != null ? formatMs(totalMs) : "");
  const [eBib, setEBib] = useState(bib ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalParsed = parseTimeToMs(eTotal);

  async function save() {
    if (!eEvent.trim()) return setErr(t("raceEdit.errEvent"));
    if (eTotal.trim() && totalParsed == null) return setErr(t("raceEdit.errTime"));
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    // splits 는 통째로 덮어쓰지 않고 bib 만 병합한다 (구간 기록 보존)
    const { data: cur, error: readErr } = await supabase
      .from("race_results")
      .select("splits")
      .eq("id", raceId)
      .maybeSingle();
    if (readErr) {
      setBusy(false);
      return setErr(readErr.message);
    }
    const splits = { ...((cur?.splits ?? {}) as Record<string, unknown>) };
    if (eBib.trim()) splits.bib = eBib.trim();
    else delete splits.bib;

    const { error } = await supabase
      .from("race_results")
      .update({
        event: eEvent.trim(),
        event_date: eDate || null,
        division: eDiv || null,
        total_time_ms: totalParsed,
        splits,
      })
      .eq("id", raceId);
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  const field =
    "rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-muted hover:text-foreground"
      >
        {t("common.edit")}
      </button>
    );

  return (
    <div className="w-full rounded-md bg-surface p-4">
      <h2 className="text-sm font-bold">{t("raceEdit.title")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("raceEdit.event")}
          <input
            value={eEvent}
            onChange={(e) => setEEvent(e.target.value)}
            maxLength={120}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("raceEdit.date")}
          <input
            type="date"
            value={eDate}
            onChange={(e) => setEDate(e.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("raceEdit.division")}
          <select
            value={eDiv}
            onChange={(e) => setEDiv(e.target.value)}
            className={field}
          >
            <option value="">—</option>
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {t(`division.${d}` as DictKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("raceEdit.total")}
          <input
            value={eTotal}
            onChange={(e) => setETotal(e.target.value)}
            placeholder="1:23:45"
            className={`${field} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("raceEdit.bib")}
          <input
            value={eBib}
            onChange={(e) => setEBib(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            maxLength={8}
            className={`${field} font-mono`}
          />
        </label>
      </div>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          className="rounded-md px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-accent px-5 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
