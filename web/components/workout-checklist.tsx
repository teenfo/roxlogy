"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import {
  WorkoutSetEditor,
  setsSummary,
  type ItemSet,
  type SetRow,
} from "@/components/workout-sets";
import type { WorkoutTarget } from "@/lib/target";

export type ChecklistItem = {
  id: string;
  name: string;
  exerciseId: string | null;
  /** 처방 배지들 — 서버에서 targetParts 로 조립해 전달 */
  targetParts: string[];
  /** 처방 원본 — 세트 표가 어떤 칸을 보여 줄지 정한다 */
  target: WorkoutTarget | null;
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
  initialSets,
  hero,
}: {
  items: ChecklistItem[];
  initialCompletions: Completion[];
  /** 세트별 수행 기록 (workout_item_sets) */
  initialSets: ItemSet[];
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
  // 종목별 세트 행 — 저장 전 편집 상태도 여기 담는다
  const [setsByItem, setSetsByItem] = useState<Map<string, SetRow[]>>(() => {
    const m = new Map<string, SetRow[]>();
    for (const s of initialSets) {
      const arr = m.get(s.itemId) ?? [];
      arr.push({
        id: s.id,
        setNo: s.setNo,
        reps: s.reps,
        weightKg: s.weightKg,
        distanceM: s.distanceM,
        durationS: s.durationS,
      });
      m.set(s.itemId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.setNo - b.setNo);
    return m;
  });
  const [draft, setDraft] = useState<SetRow[]>([]);
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

  // 세트 편집 열기 — 기록이 없으면 처방 세트 수만큼 빈 줄을 깔아 준다
  function openEditor(it: ChecklistItem) {
    const saved = setsByItem.get(it.id) ?? [];
    if (saved.length > 0) setDraft(saved.map((r) => ({ ...r })));
    else {
      const n = Math.min(Math.max(it.target?.sets ?? 1, 1), 20);
      setDraft(
        Array.from({ length: n }, (_, i) => ({
          id: null,
          setNo: i + 1,
          reps: null,
          weightKg: null,
          distanceM: null,
          durationS: null,
        })),
      );
    }
    setOpenId(it.id);
  }

  // 세트 저장 — 값이 하나도 없는 줄은 저장하지 않고, 지운 줄은 서버에서도 지운다
  async function saveSets(id: string) {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const filled = draft
      .filter(
        (r) =>
          r.reps != null || r.weightKg != null || r.distanceM != null || r.durationS != null,
      )
      .map((r, i) => ({ ...r, setNo: i + 1 }));

    // 먼저 이 종목의 기존 세트를 지우고 다시 넣는다 — 세트 번호가 밀릴 수 있어
    // 부분 갱신보다 통째로 맞추는 편이 어긋나지 않는다(행 수가 최대 50줄이라 가볍다).
    const { error: delErr } = await supabase
      .from("workout_item_sets")
      .delete()
      .eq("item_id", id);
    if (delErr) {
      setPending(false);
      setError(t("workouts.saveErr"));
      return;
    }
    if (filled.length > 0) {
      const { error: insErr } = await supabase.from("workout_item_sets").insert(
        filled.map((r) => ({
          item_id: id,
          set_no: r.setNo,
          reps: r.reps,
          weight_kg: r.weightKg,
          distance_m: r.distanceM,
          duration_s: r.durationS,
        })),
      );
      if (insErr) {
        setPending(false);
        setError(t("workouts.saveErr"));
        return;
      }
    }
    setPending(false);
    setSetsByItem((m) => {
      const n = new Map(m);
      if (filled.length > 0) n.set(id, filled);
      else n.delete(id);
      return n;
    });
    // 세트를 적으면 그 종목은 수행한 것(서버 트리거도 같은 규칙)
    if (filled.length > 0) setDone((d) => new Set(d).add(id));
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
          <div className="h-2 overflow-hidden rounded-full bg-line">
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
          const rows = setsByItem.get(it.id) ?? [];
          const legacy = logs.get(it.id);
          const summary = rows.length ? setsSummary(rows, t) : legacy ? logSummary(legacy) : "";
          const isOpen = openId === it.id;
          return (
            <li
              key={it.id}
              className={`overflow-hidden rounded-[14px] border ${
                isDone ? "border-success-line bg-success-card" : "border-line bg-card"
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
                        : "border-line-strongest text-transparent hover:border-accent"
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

                  {summary && !isOpen && (
                    <p className="tabular truncate text-[13px] text-success">{summary}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => (isOpen ? setOpenId(null) : openEditor(it))}
                  className="flex h-9 shrink-0 items-center rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold transition-colors hover:border-line-strong max-md:col-start-2 max-md:justify-self-end"
                >
                  {isOpen
                    ? t("workouts.collapse")
                    : rows.length || legacy
                      ? `✓ ${t("workouts.logged")}`
                      : t("workouts.log")}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-line bg-inset px-[18px] py-4 pl-[76px] max-md:px-4 max-md:pl-4">
                  <WorkoutSetEditor
                    rows={draft}
                    target={it.target}
                    pending={pending}
                    onChange={setDraft}
                    onSave={() => saveSets(it.id)}
                    onCancel={() => setOpenId(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {/* 완료 바 — 남은 종목 / 전부 체크 / 완료됨 세 상태 */}
      <div
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-[14px] border px-5 py-4 max-md:grid-cols-1 ${
          allDone
            ? "border-success-line bg-success-card"
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
