"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { RUN_EXERCISE_ID, STATIONS } from "@/lib/hyrox";
import { programDayDate } from "@/lib/format";
import { targetParts, type WorkoutTarget } from "@/lib/target";

/** 레이스 시뮬 전체 종목 순서: (런 → 스테이션) × 8 = 16 */
const RACE_SIM_SEQUENCE: string[] = STATIONS.flatMap((s) => [
  RUN_EXERCISE_ID,
  s.exerciseId,
]);

type Item = {
  id: string;
  seq: number;
  target: WorkoutTarget | null;
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
  category: string | null;
};

const WORKOUT_TYPES = ["race_sim", "wod", "run", "strength"] as const;

/** 항목 추가 폼 초안 — 처방은 숫자 필드로 입력받아 target 으로 구조화한다 */
type TargetDraft = {
  ex: string;
  distance: string;
  weight: string;
  reps: string;
  sets: string;
  duration: string;
  note: string;
};
const EMPTY_DRAFT: TargetDraft = {
  ex: "",
  distance: "",
  weight: "",
  reps: "",
  sets: "",
  duration: "",
  note: "",
};

type TargetField = "distance" | "weight" | "reps" | "sets" | "duration";

/** 종목 성격에 맞는 처방 칸만 노출 */
function fieldsFor(ex: Exercise | undefined): TargetField[] {
  if (!ex) return [];
  if (ex.station_type) return ["distance", "weight", "reps", "sets"];
  switch (ex.category) {
    case "running":
      return ["distance", "sets", "duration"];
    case "strength":
      return ["weight", "reps", "sets"];
    case "conditioning":
      return ["distance", "reps", "sets", "duration"];
    case "mobility":
      return ["duration", "sets"];
    default:
      return ["distance", "weight", "reps", "sets", "duration"];
  }
}

export function ProgramBuilder({
  programId,
  initialDays,
  exercises,
  locale,
  startDate = null,
}: {
  programId: string;
  initialDays: Day[];
  exercises: Exercise[];
  locale: string;
  startDate?: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  // 각 워크아웃별 항목 추가 폼 상태
  const [pick, setPick] = useState<Record<string, TargetDraft>>({});

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

  // Day 순서 이동 — 이웃 Day 와 day_index 를 맞바꾼다 (initialDays 는 정렬 상태로 전달됨)
  const moveDay = (id: string, dir: -1 | 1) => {
    const idx = initialDays.findIndex((d) => d.id === id);
    const other = initialDays[idx + dir];
    if (idx < 0 || !other) return;
    const me = initialDays[idx];
    return run(async () => {
      await Promise.all([
        supabase.from("program_days").update({ day_index: other.day_index }).eq("id", me.id),
        supabase.from("program_days").update({ day_index: me.day_index }).eq("id", other.id),
      ]);
    });
  };

  const addWorkout = (
    dayId: string,
    title: string,
    type: string,
    autofillRaceSim: boolean,
  ) =>
    run(async () => {
      const { data: created } = await supabase
        .from("workout_templates")
        .insert({
          program_day_id: dayId,
          title: title.trim() || t("programs.untitledWorkout"),
          type,
          structure: {},
        })
        .select("id")
        .single();
      // 레이스 시뮬 자동 등록: 전체 종목(런+8스테이션)을 순서대로 항목으로 추가
      if (autofillRaceSim && created?.id) {
        const rows = RACE_SIM_SEQUENCE.map((exId, i) => ({
          template_id: created.id,
          seq: i + 1,
          exercise_id: exId,
          target: null,
        }));
        await supabase.from("workout_template_items").insert(rows);
      }
    });

  const delWorkout = (id: string) =>
    run(() => supabase.from("workout_templates").delete().eq("id", id));

  const setWorkoutType = (id: string, type: string) =>
    run(() => supabase.from("workout_templates").update({ type }).eq("id", id));

  const addItem = (w: Workout) => {
    const p = pick[w.id];
    if (!p?.ex) return;
    const num = (v: string) => {
      const n = Number(v.trim());
      return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const target: WorkoutTarget = {};
    const d = num(p.distance);
    if (d) target.distance_m = Math.round(d);
    const kg = num(p.weight);
    if (kg) target.weight_kg = kg;
    const reps = num(p.reps);
    if (reps) target.reps = Math.round(reps);
    const sets = num(p.sets);
    if (sets) target.sets = Math.round(sets);
    const dur = num(p.duration);
    if (dur) target.duration_s = Math.round(dur);
    if (p.note.trim()) target.note = p.note.trim();
    const nextSeq =
      w.workout_template_items.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
    return run(async () => {
      await supabase.from("workout_template_items").insert({
        template_id: w.id,
        seq: nextSeq,
        exercise_id: p.ex,
        target: Object.keys(target).length ? target : null,
      });
      setPick((s) => ({ ...s, [w.id]: EMPTY_DRAFT }));
    });
  };

  const delItem = (id: string) =>
    run(() => supabase.from("workout_template_items").delete().eq("id", id));

  const inputCls =
    "rounded-md border border-muted/30 bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent";

  return (
    <div className="mt-8 flex flex-col gap-4">
      {initialDays.map((d, i) => (
        <DayCard
          key={d.id}
          day={d}
          dayDate={programDayDate(startDate, d.day_index, locale)}
          exercises={exercises}
          exName={exName}
          locale={locale}
          pick={pick}
          setPick={setPick}
          busy={busy}
          inputCls={inputCls}
          canUp={i > 0}
          canDown={i < initialDays.length - 1}
          onMove={(dir) => moveDay(d.id, dir)}
          onDelDay={() => delDay(d.id)}
          onAddWorkout={(title, type, autofill) =>
            addWorkout(d.id, title, type, autofill)
          }
          onSetWorkoutType={setWorkoutType}
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
  dayDate,
  exercises,
  exName,
  locale,
  pick,
  setPick,
  busy,
  inputCls,
  canUp,
  canDown,
  onMove,
  onDelDay,
  onAddWorkout,
  onSetWorkoutType,
  onDelWorkout,
  onAddItem,
  onDelItem,
}: {
  day: Day;
  dayDate: string | null;
  exercises: Exercise[];
  exName: (ex: { name_ko: string; name_en: string } | null) => string;
  locale: string;
  pick: Record<string, TargetDraft>;
  setPick: React.Dispatch<React.SetStateAction<Record<string, TargetDraft>>>;
  busy: boolean;
  inputCls: string;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onDelDay: () => void;
  onAddWorkout: (title: string, type: string, autofillRaceSim: boolean) => void;
  onSetWorkoutType: (id: string, type: string) => void;
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
          {dayDate ? (
            <span className="ml-2 text-xs font-medium text-track">{dayDate}</span>
          ) : null}
          {day.focus ? ` · ${day.focus}` : ""}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={busy || !canUp}
            aria-label="move up"
            className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-background hover:text-foreground disabled:opacity-25"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={busy || !canDown}
            aria-label="move down"
            className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-background hover:text-foreground disabled:opacity-25"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={onDelDay}
            disabled={busy}
            className="ml-2 text-xs text-muted hover:text-red-400"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {day.workout_templates.map((w) => (
          <div key={w.id} className="rounded-md bg-background px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold">
                {w.title}
                <select
                  value={w.type}
                  disabled={busy}
                  onChange={(e) => onSetWorkoutType(w.id, e.target.value)}
                  className="rounded border border-muted/30 bg-surface px-1.5 py-0.5 text-xs font-normal text-muted outline-none focus:border-accent"
                >
                  {WORKOUT_TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`programs.type.${ty}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
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

            {w.workout_template_items.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {w.workout_template_items
                  .slice()
                  .sort((a, b) => a.seq - b.seq)
                  .map((it, i) => (
                    <li
                      key={it.id}
                      className="rounded-md bg-surface px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                          {exName(it.exercises)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDelItem(it.id)}
                          disabled={busy}
                          aria-label={t("common.delete")}
                          className="shrink-0 text-sm text-muted hover:text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                      {targetParts(it.target, locale).length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1 pl-8">
                          {targetParts(it.target, locale).map((part, j) => (
                            <span
                              key={j}
                              className="rounded bg-accent/15 px-2 py-0.5 font-mono text-xs font-semibold text-accent"
                            >
                              {part}
                            </span>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-md border border-dashed border-muted/25 px-3 py-2 text-xs text-muted">
                {t("programs.noItems")}
              </p>
            )}

            {/* 항목 추가 — 처방은 종목 성격에 맞는 숫자 칸으로 입력 */}
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                value={pick[w.id]?.ex ?? ""}
                onChange={(e) =>
                  setPick((s) => ({
                    ...s,
                    [w.id]: { ...EMPTY_DRAFT, ...s[w.id], ex: e.target.value },
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
              {fieldsFor(exercises.find((ex) => ex.id === pick[w.id]?.ex)).map(
                (f) => (
                  <input
                    key={f}
                    value={pick[w.id]?.[f] ?? ""}
                    onChange={(e) =>
                      setPick((s) => ({
                        ...s,
                        [w.id]: {
                          ...EMPTY_DRAFT,
                          ...s[w.id],
                          [f]: e.target.value.replace(/[^0-9.]/g, ""),
                        },
                      }))
                    }
                    inputMode="decimal"
                    placeholder={t(
                      `programs.tgt.${f}` as Parameters<typeof t>[0],
                    )}
                    className={`${inputCls} w-20`}
                  />
                ),
              )}
              <input
                value={pick[w.id]?.note ?? ""}
                onChange={(e) =>
                  setPick((s) => ({
                    ...s,
                    [w.id]: { ...EMPTY_DRAFT, ...s[w.id], note: e.target.value },
                  }))
                }
                placeholder={t("programs.targetPh")}
                className={`${inputCls} w-32`}
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
            const autofill =
              wType === "race_sim"
                ? window.confirm(t("programs.raceSimConfirm"))
                : false;
            onAddWorkout(wTitle, wType, autofill);
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
