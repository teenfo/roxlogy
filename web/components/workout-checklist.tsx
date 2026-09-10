"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export type ChecklistItem = {
  id: string;
  name: string;
  exerciseId: string | null;
  /** 처방 배지들 — 서버에서 targetParts 로 조립해 전달 */
  targetParts: string[];
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
  hero,
}: {
  items: ChecklistItem[];
  initialCompletions: Completion[];
  /** 히어로 상단부 — 진행 바가 이 상태를 쓰므로 한 카드로 붙여 그린다 */
  hero?: React.ReactNode;
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
      <>
        {hero}
        <p className="rounded-[14px] border border-line bg-card px-4 py-10 text-center text-sm text-muted">
          {t("workouts.noItems")}
        </p>
      </>
    );
  }

  return (
    <>
      {/* 히어로 + 진행 바 — 진행 상태가 여기 있어서 한 카드로 붙인다 */}
      <section className="overflow-hidden rounded-2xl border border-line-mid bg-card">
        {hero}
        <div className="flex flex-col gap-2 px-6 pb-[18px] max-md:px-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{t("workouts.progressLabel")}</span>
            <span className="tabular font-bold">
              {t("workouts.progress", { done: doneCount, total })}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#222]">
            <div
              className="h-full rounded-full bg-accent transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </section>

      {/* 종목 카드 */}
      <ul className="flex flex-col gap-2">
        {items.map((it, i) => {
          const isDone = done.has(it.id);
          const log = logs.get(it.id);
          const isOpen = openId === it.id;
          return (
            <li
              key={it.id}
              className={`overflow-hidden rounded-[14px] border ${
                isDone ? "border-[#1e3328] bg-[#101410]" : "border-line bg-card"
              }`}
            >
              <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-3.5 px-[18px] py-4 max-md:grid-cols-[40px_minmax(0,1fr)] max-md:px-4">
                {/* 체크 원 — 44px 히트 영역 안에 32px 원 */}
                <button
                  type="button"
                  onClick={() => toggleItem(it.id)}
                  aria-pressed={isDone}
                  aria-label={t("workouts.toggleItem", { name: it.name })}
                  className="flex h-11 w-11 items-center justify-center max-md:h-10 max-md:w-10"
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-[15px] font-extrabold transition-colors ${
                      isDone
                        ? "border-success bg-success text-background"
                        : "border-[#444] text-transparent hover:border-accent"
                    }`}
                  >
                    ✓
                  </span>
                </button>

                <div className="flex min-w-0 flex-col gap-2">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="tabular text-xs font-bold text-muted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {it.exerciseId ? (
                      <Link
                        href={`/exercises/${it.exerciseId}`}
                        className={`min-w-0 truncate text-lg font-extrabold hover:text-accent ${
                          isDone ? "text-muted line-through" : ""
                        }`}
                      >
                        {it.name}
                      </Link>
                    ) : (
                      <span
                        className={`min-w-0 truncate text-lg font-extrabold ${
                          isDone ? "text-muted line-through" : ""
                        }`}
                      >
                        {it.name}
                      </span>
                    )}
                  </p>

                  {it.targetParts.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {it.targetParts.map((part, j) => (
                        <span
                          key={j}
                          className="tabular flex h-7 items-center rounded-lg border border-line-mid bg-page px-2.5 text-[13px] font-bold"
                        >
                          {part}
                        </span>
                      ))}
                    </span>
                  )}

                  {log && logSummary(log) && !isOpen && (
                    <p className="tabular truncate text-[13px] text-success">
                      {logSummary(log)}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : it.id)}
                  className="flex h-9 shrink-0 items-center rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold transition-colors hover:border-[#555] max-md:col-start-2 max-md:justify-self-end"
                >
                  {isOpen
                    ? t("workouts.collapse")
                    : log
                      ? `✓ ${t("workouts.logged")}`
                      : t("workouts.log")}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-line bg-inset px-[18px] py-4 pl-[76px] max-md:px-4 max-md:pl-4">
                  <LogEditor
                    initial={log ?? { weightKg: null, reps: null, note: null }}
                    pending={pending}
                    onSave={(l) => saveLog(it.id, l)}
                    onCancel={() => setOpenId(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* 완료 바 — 남은 종목 / 전부 체크 / 완료됨 세 상태 */}
      <div
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-[14px] border px-5 py-4 max-md:grid-cols-1 ${
          allDone
            ? "border-[#1e3328] bg-[#101410]"
            : "border-line bg-card"
        }`}
      >
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold [word-break:keep-all]">
            {allDone
              ? `✓ ${t("workouts.doneTitle")}`
              : t("workouts.remaining", { n: total - doneCount })}
          </p>
          <p className="mt-0.5 text-[13px] text-muted [word-break:keep-all]">
            {allDone ? t("workouts.doneHint") : t("workouts.markHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleWod}
          disabled={pending}
          className={`flex h-11 items-center justify-center rounded-lg px-5 text-[15px] font-extrabold transition disabled:opacity-40 max-md:w-full ${
            allDone
              ? "bg-success-bg text-success"
              : "bg-accent text-background hover:brightness-110"
          }`}
        >
          {pending
            ? t("workouts.saving")
            : allDone
              ? t("workouts.unmarkWod")
              : t("workouts.markWod")}
        </button>
      </div>
    </>
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
        <label className="min-w-0 flex-1 text-xs text-muted">
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
        <label className="min-w-0 flex-1 text-xs text-muted">
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
