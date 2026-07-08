"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

type Item = {
  id: string;
  seq: number;
  target: { note?: string } | null;
  exercises: { name_ko: string; name_en: string } | null;
};
type Workout = {
  id: string;
  title: string;
  type: string;
  workout_template_items: Item[];
};
type Day = {
  id: string;
  day_index: number;
  focus: string | null;
  notes: string | null;
  workout_templates: Workout[];
};
type Exercise = {
  id: string;
  name_ko: string;
  name_en: string;
  station_type: string | null;
};

const WORKOUT_TYPES = ["race_sim", "wod", "run", "strength"] as const;

export function ProgramBuilder({
  programId,
  initialDays,
  exercises,
  locale,
}: {
  programId: string;
  initialDays: Day[];
  exercises: Exercise[];
  locale: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  // 각 워크아웃별 항목 추가 폼 상태
  const [pick, setPick] = useState<Record<string, { ex: string; note: string }>>(
    {},
  );

  const exName = (ex: { name_ko: string; name_en: string } | null) =>
    ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : "—";

  async function run(fn: () => PromiseLike<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  }

  const addDay = () =>
    run(async () => {
      const nextIndex =
        initialDays.reduce((m, d) => Math.max(m, d.day_index), 0) + 1;
      await supabase
        .from("program_days")
        .insert({ program_id: programId, day_index: nextIndex });
    });

  const delDay = (id: string) =>
    run(() => supabase.from("program_days").delete().eq("id", id));

  const addWorkout = (dayId: string, title: string, type: string) =>
    run(() =>
      supabase.from("workout_templates").insert({
        program_day_id: dayId,
        title: title.trim() || t("programs.untitledWorkout"),
        type,
        structure: {},
      }),
    );

  const delWorkout = (id: string) =>
    run(() => supabase.from("workout_templates").delete().eq("id", id));

  const addItem = (w: Workout) => {
    const p = pick[w.id];
    if (!p?.ex) return;
    const nextSeq =
      w.workout_template_items.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
    return run(async () => {
      await supabase.from("workout_template_items").insert({
        template_id: w.id,
        seq: nextSeq,
        exercise_id: p.ex,
        target: p.note.trim() ? { note: p.note.trim() } : null,
      });
      setPick((s) => ({ ...s, [w.id]: { ex: "", note: "" } }));
    });
  };

  const delItem = (id: string) =>
    run(() => supabase.from("workout_template_items").delete().eq("id", id));

  const inputCls =
    "rounded-md border border-muted/30 bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent";

  return (
    <div className="mt-8 flex flex-col gap-4">
      {initialDays.map((d) => (
        <DayCard
          key={d.id}
          day={d}
          exercises={exercises}
          exName={exName}
          pick={pick}
          setPick={setPick}
          busy={busy}
          inputCls={inputCls}
          onDelDay={() => delDay(d.id)}
          onAddWorkout={(title, type) => addWorkout(d.id, title, type)}
          onDelWorkout={delWorkout}
          onAddItem={addItem}
          onDelItem={delItem}
        />
      ))}

      <button
        type="button"
        onClick={addDay}
        disabled={busy}
        className="rounded-md border border-dashed border-muted/40 px-4 py-3 text-sm text-muted hover:border-foreground hover:text-foreground disabled:opacity-50"
      >
        + {t("programs.addDay")}
      </button>
    </div>
  );
}

function DayCard({
  day,
  exercises,
  exName,
  pick,
  setPick,
  busy,
  inputCls,
  onDelDay,
  onAddWorkout,
  onDelWorkout,
  onAddItem,
  onDelItem,
}: {
  day: Day;
  exercises: Exercise[];
  exName: (ex: { name_ko: string; name_en: string } | null) => string;
  pick: Record<string, { ex: string; note: string }>;
  setPick: React.Dispatch<
    React.SetStateAction<Record<string, { ex: string; note: string }>>
  >;
  busy: boolean;
  inputCls: string;
  onDelDay: () => void;
  onAddWorkout: (title: string, type: string) => void;
  onDelWorkout: (id: string) => void;
  onAddItem: (w: Workout) => void;
  onDelItem: (id: string) => void;
}) {
  const { t } = useI18n();
  const [wTitle, setWTitle] = useState("");
  const [wType, setWType] = useState<string>("wod");

  return (
    <section className="rounded-md bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {t("programs.dayN", { n: day.day_index })}
          {day.focus ? ` · ${day.focus}` : ""}
        </h2>
        <button
          type="button"
          onClick={onDelDay}
          disabled={busy}
          className="text-xs text-muted hover:text-red-400"
        >
          {t("common.delete")}
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {day.workout_templates.map((w) => (
          <div key={w.id} className="rounded-md bg-background px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                {w.title}
                <span className="ml-2 text-xs text-muted">
                  {t(`programs.type.${w.type}` as Parameters<typeof t>[0])}
                </span>
              </p>
              <button
                type="button"
                onClick={() => onDelWorkout(w.id)}
                disabled={busy}
                className="text-xs text-muted hover:text-red-400"
              >
                {t("common.delete")}
              </button>
            </div>

            <ul className="mt-1.5 flex flex-col gap-1">
              {w.workout_template_items
                .slice()
                .sort((a, b) => a.seq - b.seq)
                .map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <span>{exName(it.exercises)}</span>
                    <span className="flex items-center gap-2">
                      {it.target?.note && (
                        <span className="font-mono text-muted">
                          {it.target.note}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelItem(it.id)}
                        disabled={busy}
                        className="text-muted hover:text-red-400"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
            </ul>

            {/* 항목 추가 */}
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                value={pick[w.id]?.ex ?? ""}
                onChange={(e) =>
                  setPick((s) => ({
                    ...s,
                    [w.id]: { ex: e.target.value, note: s[w.id]?.note ?? "" },
                  }))
                }
                className={`${inputCls} min-w-40 flex-1`}
              >
                <option value="">{t("programs.pickExercise")}</option>
                {exercises.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {exName(ex)}
                  </option>
                ))}
              </select>
              <input
                value={pick[w.id]?.note ?? ""}
                onChange={(e) =>
                  setPick((s) => ({
                    ...s,
                    [w.id]: { ex: s[w.id]?.ex ?? "", note: e.target.value },
                  }))
                }
                placeholder={t("programs.targetPh")}
                className={`${inputCls} w-28`}
              />
              <button
                type="button"
                onClick={() => onAddItem(w)}
                disabled={busy || !pick[w.id]?.ex}
                className="rounded-md border border-muted/40 px-3 py-1.5 text-xs font-semibold hover:border-foreground disabled:opacity-40"
              >
                + {t("programs.addItem")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 워크아웃 추가 */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-background pt-3">
        <input
          value={wTitle}
          onChange={(e) => setWTitle(e.target.value)}
          placeholder={t("programs.workoutTitlePh")}
          className={`${inputCls} min-w-40 flex-1`}
        />
        <select
          value={wType}
          onChange={(e) => setWType(e.target.value)}
          className={inputCls}
        >
          {WORKOUT_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`programs.type.${ty}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            onAddWorkout(wTitle, wType);
            setWTitle("");
          }}
          disabled={busy}
          className="rounded-md border border-muted/40 px-3 py-1.5 text-xs font-semibold hover:border-foreground disabled:opacity-50"
        >
          + {t("programs.addWorkout")}
        </button>
      </div>
    </section>
  );
}
