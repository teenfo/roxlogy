"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export type ChecklistItem = {
  id: string;
  name: string;
  exerciseId: string | null;
  targetNote: string | null;
};

export type ItemLog = {
  weightKg: number | null;
  reps: number | null;
  note: string | null;
};

export type Completion = ItemLog & { itemId: string };

export function WorkoutChecklist({
  items,
  initialCompletions,
}: {
  items: ChecklistItem[];
  initialCompletions: Completion[];
}) {
  const { t } = useI18n();
  const [done, setDone] = useState<Set<string>>(
    new Set(initialCompletions.map((c) => c.itemId)),
  );
  const [logs, setLogs] = useState<Map<string, ItemLog>>(
    new Map(
      initialCompletions.map((c) => [
        c.itemId,
        { weightKg: c.weightKg, reps: c.reps, note: c.note },
      ]),
    ),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.length;
  const doneCount = items.filter((it) => done.has(it.id)).length;
  const allDone = total > 0 && doneCount === total;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  async function toggleItem(id: string) {
    const wasDone = done.has(id);
    const prevDone = done;
    const next = new Set(done);
    if (wasDone) next.delete(id);
    else next.add(id);
    setDone(next);
    setError(null);

    const supabase = createClient();
    if (wasDone) {
      const { error: err } = await supabase
        .from("workout_item_completions")
        .delete()
        .eq("item_id", id);
      if (err) {
        setDone(prevDone);
        setError(t("workouts.saveErr"));
      } else {
        setLogs((m) => {
          const n = new Map(m);
          n.delete(id);
          return n;
        });
        if (openId === id) setOpenId(null);
      }
    } else {
      const { error: err } = await supabase
        .from("workout_item_completions")
        .upsert(
          { item_id: id },
          { onConflict: "user_id,item_id", ignoreDuplicates: true },
        );
      if (err) {
        setDone(prevDone);
        setError(t("workouts.saveErr"));
      }
    }
  }

  // 수행 무게/횟수/메모 저장 — 값 입력은 곧 완료를 의미하므로 완료 처리도 함께
  async function saveLog(id: string, log: ItemLog) {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("workout_item_completions")
      .upsert(
        {
          item_id: id,
          weight_kg: log.weightKg,
          reps: log.reps,
          note: log.note,
        },
        { onConflict: "user_id,item_id" },
      );
    setPending(false);
    if (err) {
      setError(t("workouts.saveErr"));
      return;
    }
    setLogs((m) => new Map(m).set(id, log));
    setDone((d) => new Set(d).add(id));
    setOpenId(null);
  }

  // WOD 완료 처리 → 모든 아이템 완료 / 완료 취소 → 모든 아이템 완료 해제
  async function toggleWod() {
    if (total === 0) return;
    const prevDone = done;
    setPending(true);
    setError(null);
    const supabase = createClient();
    const ids = items.map((it) => it.id);

    if (allDone) {
      setDone(new Set());
      const { error: err } = await supabase
        .from("workout_item_completions")
        .delete()
        .in("item_id", ids);
      setPending(false);
      if (err) {
        setDone(prevDone);
        setError(t("workouts.saveErr"));
      } else {
        setLogs(new Map());
      }
    } else {
      setDone(new Set(ids));
      const { error: err } = await supabase
        .from("workout_item_completions")
        .upsert(
          ids.map((item_id) => ({ item_id })),
          { onConflict: "user_id,item_id", ignoreDuplicates: true },
        );
      setPending(false);
      if (err) {
        setDone(prevDone);
        setError(t("workouts.saveErr"));
      }
    }
  }

  if (total === 0) {
    return (
      <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
        {t("workouts.noItems")}
      </p>
    );
  }

  return (
    <div className="mt-6">
      {/* 진행률 */}
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
          <div
            className={`h-full rounded-full transition-all ${
              allDone ? "bg-track" : "bg-accent"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-semibold text-muted">
          {t("workouts.progress", { done: doneCount, total })}
        </span>
      </div>

      {allDone && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-track">
          <span aria-hidden>✓</span>
          {t("workouts.wodDone")}
        </p>
      )}

      {/* 운동 체크리스트 */}
      <ul className="mt-4 flex flex-col gap-1.5">
        {items.map((it, i) => {
          const isDone = done.has(it.id);
          const log = logs.get(it.id);
          const isOpen = openId === it.id;
          return (
            <li key={it.id} className="rounded-md bg-surface px-3 py-2.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleItem(it.id)}
                  aria-pressed={isDone}
                  aria-label={t("workouts.toggleItem", { name: it.name })}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ${
                    isDone
                      ? "border-track bg-track text-background"
                      : "border-muted/50 text-transparent hover:border-accent"
                  }`}
                >
                  ✓
                </button>
                <span className="w-5 text-right font-mono text-xs text-muted">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {it.exerciseId ? (
                    <Link
                      href={`/exercises/${it.exerciseId}`}
                      className={`block truncate text-sm font-medium hover:text-accent ${
                        isDone ? "text-muted line-through" : ""
                      }`}
                    >
                      {it.name}
                    </Link>
                  ) : (
                    <span
                      className={`block truncate text-sm font-medium ${
                        isDone ? "text-muted line-through" : ""
                      }`}
                    >
                      {it.name}
                    </span>
                  )}
                  {log && logSummary(log) && !isOpen && (
                    <p className="mt-0.5 truncate font-mono text-xs text-track">
                      {logSummary(log)}
                    </p>
                  )}
                </div>
                {it.targetNote && (
                  <span className="shrink-0 rounded bg-accent/15 px-2 py-0.5 font-mono text-xs font-semibold text-accent">
                    {it.targetNote}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : it.id)}
                  className="shrink-0 text-xs font-semibold text-muted hover:text-accent"
                >
                  {t("workouts.log")}
                </button>
              </div>

              {isOpen && (
                <LogEditor
                  initial={log ?? { weightKg: null, reps: null, note: null }}
                  pending={pending}
                  onSave={(l) => saveLog(it.id, l)}
                  onCancel={() => setOpenId(null)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={toggleWod}
        disabled={pending}
        className={`mt-4 w-full rounded-md px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-40 ${
          allDone
            ? "bg-surface text-muted hover:text-foreground"
            : "bg-track text-background hover:brightness-110"
        }`}
      >
        {pending
          ? t("workouts.saving")
          : allDone
            ? t("workouts.unmarkWod")
            : t("workouts.markWod")}
      </button>
    </div>
  );
}

function logSummary(log: ItemLog): string {
  const parts: string[] = [];
  if (log.weightKg != null) parts.push(`${log.weightKg} kg`);
  if (log.reps != null) parts.push(`× ${log.reps}`);
  if (log.note) parts.push(log.note);
  return parts.join(" · ");
}

function LogEditor({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial: ItemLog;
  pending: boolean;
  onSave: (log: ItemLog) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [weight, setWeight] = useState(
    initial.weightKg != null ? String(initial.weightKg) : "",
  );
  const [reps, setReps] = useState(
    initial.reps != null ? String(initial.reps) : "",
  );
  const [note, setNote] = useState(initial.note ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const w = weight.trim() === "" ? null : Number(weight);
    const r = reps.trim() === "" ? null : Number(reps);
    onSave({
      weightKg: w != null && Number.isFinite(w) ? w : null,
      reps: r != null && Number.isFinite(r) ? Math.round(r) : null,
      note: note.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="mt-2 grid gap-2 pl-9">
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-muted">
          {t("workouts.weightKg")}
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="mt-1 w-full rounded-md border border-muted/30 bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="flex-1 text-xs text-muted">
          {t("workouts.reps")}
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            className="mt-1 w-full rounded-md border border-muted/30 bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          />
        </label>
      </div>
      <label className="text-xs text-muted">
        {t("workouts.logNote")}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("workouts.logNotePh")}
          className="mt-1 w-full rounded-md border border-muted/30 bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {pending ? t("workouts.saving") : t("workouts.saveLog")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
