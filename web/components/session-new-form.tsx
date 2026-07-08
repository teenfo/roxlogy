"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs } from "@/lib/format";
import {
  buildSessionRows,
  raceSimTemplate,
  type SegmentForm,
} from "@/lib/session-builder";
import { TimeInput } from "@/components/time-input";
import { useI18n } from "@/components/i18n-provider";

const KIND_BADGE: Record<string, string> = {
  run: "border-track/60 text-track",
  station: "border-accent/60 text-accent",
  roxzone: "border-muted/60 text-muted",
};

type Row = SegmentForm & { text: string };

export type EditableSegment = {
  id: string;
  seq: number;
  kind: string;
  exercise_id: string | null;
  split_time_ms: number | null;
};

export type SessionInitial = {
  id: string;
  startedAt: string; // ISO
  segments: EditableSegment[]; // seq 순
  notes?: string | null;
  rpe?: number | null;
};

/** 저장된 세그먼트(빈 칸 제외·재번호됨)를 24행 템플릿에 순서대로 되맵핑 */
function rowsFromInitial(initial: SessionInitial): Row[] {
  const rows: Row[] = raceSimTemplate().map((s) => ({ ...s, text: "" }));
  let cursor = 0;
  for (const seg of initial.segments) {
    for (let i = cursor; i < rows.length; i++) {
      const r = rows[i];
      const matches =
        r.kind === seg.kind &&
        (seg.kind !== "station" || r.exerciseId === seg.exercise_id);
      if (matches) {
        if (seg.split_time_ms != null) {
          rows[i] = {
            ...r,
            splitMs: seg.split_time_ms,
            text: formatMs(seg.split_time_ms),
          };
        }
        cursor = i + 1;
        break;
      }
    }
  }
  return rows;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function SessionNewForm({ initial }: { initial?: SessionInitial }) {
  const router = useRouter();
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>(() =>
    initial
      ? rowsFromInitial(initial)
      : raceSimTemplate().map((s) => ({ ...s, text: "" })),
  );
  const [startedAt, setStartedAt] = useState(() => {
    if (initial) return toLocalInput(initial.startedAt);
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rpe, setRpe] = useState<number | null>(initial?.rpe ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const totalMs = useMemo(
    () => rows.reduce((acc, r) => acc + (r.splitMs ?? 0), 0),
    [rows],
  );

  function rowLabel(row: Row): string {
    if (row.kind === "station" && row.stationKey)
      return t(`station.${row.stationKey}` as Parameters<typeof t>[0]);
    if (row.kind === "run") return t("newSession.runLabel", { n: row.n });
    return t("newSession.roxzoneLabel", { n: row.n });
  }

  function update(idx: number, text: string, ms: number | null) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, text, splitMs: ms } : r)),
    );
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }

    const built = buildSessionRows(
      user.id,
      new Date(startedAt).toISOString(),
      rows,
      initial
        ? {
            sessionId: initial.id,
            segmentIds: initial.segments.map((s) => s.id),
            notes,
            rpe,
          }
        : { notes, rpe },
    );
    if ("error" in built) {
      setPending(false);
      return setError(t("newSession.errEmpty"));
    }

    // 멱등 업서트 — 워치/폰과 동일 계약 (003 충돌 키)
    const { error: sErr } = await supabase
      .from("sessions")
      .upsert(built.session, { onConflict: "id" });
    if (sErr) {
      setPending(false);
      return setError(t("newSession.errSession", { msg: sErr.message }));
    }
    const { error: gErr } = await supabase
      .from("session_segments")
      .upsert(built.segments, { onConflict: "session_id,seq" });
    if (gErr) {
      setPending(false);
      return setError(t("newSession.errSegments", { msg: gErr.message }));
    }
    // 수정에서 칸을 비워 세그먼트 수가 줄면 남은 꼬리 행 제거
    if (initial && initial.segments.length > built.segments.length) {
      const { error: dErr } = await supabase
        .from("session_segments")
        .delete()
        .eq("session_id", built.session.id)
        .gt("seq", built.segments.length);
      if (dErr) {
        setPending(false);
        return setError(t("newSession.errSegments", { msg: dErr.message }));
      }
    }

    router.push(`/sessions/${built.session.id}`);
    router.refresh();
  }

  return (
    <main>
      <Link
        href={initial ? `/sessions/${initial.id}` : "/sessions"}
        className="text-sm text-muted hover:text-foreground"
      >
        {t("sessions.back")}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">
        {initial ? t("newSession.editTitle") : t("newSession.title")}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {initial ? t("newSession.editDesc") : t("newSession.desc")}
      </p>

      <div className="mt-6 flex items-center gap-3">
        <label className="text-sm text-muted">{t("newSession.startTime")}</label>
        <input
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
          className="rounded-md border border-muted/30 bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">{t("newSession.rpe")}</label>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRpe(rpe === n ? null : n)}
              className={`h-8 w-8 rounded-md border text-xs font-semibold transition ${
                rpe === n
                  ? "border-accent bg-accent text-background"
                  : "border-muted/30 text-muted hover:border-foreground"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">{t("newSession.rpeHint")}</span>
      </div>

      <div className="mt-4">
        <label className="text-sm text-muted">{t("newSession.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t("newSession.notesPlaceholder")}
          className="mt-1 w-full resize-y rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <ol className="mt-6 flex flex-col gap-1.5">
        {rows.map((row, idx) => (
          <li
            key={idx}
            className="flex items-center gap-3 rounded-md bg-surface px-4 py-2"
          >
            <span className="w-6 text-right font-mono text-xs text-muted">
              {idx + 1}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-xs ${KIND_BADGE[row.kind]}`}
            >
              {t(`kind.${row.kind}`)}
            </span>
            <span className="flex-1 text-sm">{rowLabel(row)}</span>
            <TimeInput
              value={row.text}
              onChange={(text, ms) => update(idx, text, ms)}
            />
          </li>
        ))}
      </ol>

      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-4 border-t border-surface bg-background py-4">
        <p className="text-sm text-muted">
          {t("newSession.totalLabel")}{" "}
          <span className="font-mono text-lg font-semibold text-foreground">
            {formatMs(totalMs)}
          </span>
        </p>
        <div className="flex items-center gap-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={handleSave}
            disabled={pending || totalMs === 0}
            className="rounded-md bg-accent px-6 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-40"
          >
            {pending ? t("common.saving") : t("newSession.save")}
          </button>
        </div>
      </div>
    </main>
  );
}
