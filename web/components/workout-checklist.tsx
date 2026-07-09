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

export function WorkoutChecklist({
  items,
  initialCompleted,
}: {
  items: ChecklistItem[];
  initialCompleted: string[];
}) {
  const { t } = useI18n();
  const [done, setDone] = useState<Set<string>>(new Set(initialCompleted));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.length;
  const doneCount = items.filter((it) => done.has(it.id)).length;
  const allDone = total > 0 && doneCount === total;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  async function toggleItem(id: string) {
    const wasDone = done.has(id);
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
        setDone(new Set(done)); // revert
        setError(t("workouts.saveErr"));
      }
    } else {
      const { error: err } = await supabase
        .from("workout_item_completions")
        .upsert(
          { item_id: id },
          { onConflict: "user_id,item_id", ignoreDuplicates: true },
        );
      if (err) {
        setDone(new Set(done)); // revert
        setError(t("workouts.saveErr"));
      }
    }
  }

  // WOD 완료 처리 → 모든 아이템 완료 / 완료 취소 → 모든 아이템 완료 해제
  async function toggleWod() {
    if (total === 0) return;
    const prev = done;
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
        setDone(prev);
        setError(t("workouts.saveErr"));
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
        setDone(prev);
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
          return (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5"
            >
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
              {it.exerciseId ? (
                <Link
                  href={`/exercises/${it.exerciseId}`}
                  className={`flex-1 truncate text-sm font-medium hover:text-accent ${
                    isDone ? "text-muted line-through" : ""
                  }`}
                >
                  {it.name}
                </Link>
              ) : (
                <span
                  className={`flex-1 truncate text-sm font-medium ${
                    isDone ? "text-muted line-through" : ""
                  }`}
                >
                  {it.name}
                </span>
              )}
              {it.targetNote && (
                <span className="shrink-0 rounded bg-accent/15 px-2 py-0.5 font-mono text-xs font-semibold text-accent">
                  {it.targetNote}
                </span>
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
