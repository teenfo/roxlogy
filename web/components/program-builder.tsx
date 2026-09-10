"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { RUN_EXERCISE_ID, STATIONS } from "@/lib/hyrox";
import { programDayDate } from "@/lib/format";
import { dowLabel } from "@/components/program-new-form";
import { wodTypeDot } from "@/lib/wod-type";
import {
  TARGET_KEY,
  targetFieldsFor,
  targetParts,
  type TargetField,
  type WorkoutTarget,
} from "@/lib/target";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 레이스 시뮬 전체 종목 순서: (런 → 스테이션) × 8 = 16 */
const RACE_SIM_SEQUENCE: string[] = STATIONS.flatMap((s) => [
  RUN_EXERCISE_ID,
  s.exerciseId,
]);
/** 검색창 옆 빠른 추가 — 하이록스에서 제일 자주 처방하는 넷 */
const QUICK_IDS = [
  RUN_EXERCISE_ID,
  STATIONS[0].exerciseId, // 스키에르그
  STATIONS[4].exerciseId, // 로잉
  STATIONS[7].exerciseId, // 월볼
];

export type Item = {
  id: string;
  seq: number;
  exercise_id: string | null;
  target: WorkoutTarget | null;
  exercises: { name_ko: string; name_en: string } | null;
};
export type Workout = {
  id: string;
  title: string;
  type: string;
  workout_template_items: Item[];
};
export type Day = {
  id: string;
  day_index: number;
  focus: string | null;
  notes: string | null;
  workout_templates: Workout[];
};
export type Exercise = {
  id: string;
  name_ko: string;
  name_en: string;
  station_type: string | null;
  category: string | null;
};

const WORKOUT_TYPES = ["wod", "run", "strength", "race_sim"] as const;
const KNOWN_CATS = ["strength", "running", "conditioning", "mobility"];

const CAT_CHIP: Record<string, string> = {
  station: "bg-[#2a2500] text-accent-dim",
  running: "bg-info-bg text-info",
  conditioning: "bg-info-bg text-info",
  strength: "bg-[#2a1a10] text-[#f4a261]",
  mobility: "bg-label-bg text-label",
};

const catOf = (ex: Exercise) =>
  ex.station_type ? "station" : (ex.category ?? "other");

/** 인라인 편집 인풋 — 평소엔 배경 없이 글자만, 손을 대면 칸이 드러난다 */
const inlineCls =
  "min-w-0 rounded-lg border border-transparent bg-transparent px-2 outline-none hover:border-line-strong hover:bg-page focus:border-accent focus:bg-page";

type Draft = {
  ex: string;
  q: string;
  open: boolean;
  hi: number;
  vals: Partial<Record<TargetField, string>>;
  note: string;
};
const EMPTY_DRAFT: Draft = { ex: "", q: "", open: false, hi: 0, vals: {}, note: "" };

export function ProgramBuilder({
  programId,
  initialDays,
  exercises,
  locale,
  startDate = null,
  weeks = null,
  weekPattern = null,
  previewHref,
  enrollSlot,
}: {
  programId: string;
  initialDays: Day[];
  exercises: Exercise[];
  locale: string;
  startDate?: string | null;
  weeks?: number | null;
  /** 훈련 요일 (0=월 … 6=일) — 일자 카드의 요일 표시와 주 묶기에 쓴다 */
  weekPattern?: number[] | null;
  /** 읽기 뷰 링크 — 남에게 어떻게 보이는지 확인용 */
  previewHref?: string;
  /** 하단 바 오른쪽 (시작하기 버튼) — 서버에서 만들어 넣는다 */
  enrollSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const { t, tag } = useI18n();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, Draft>>({});
  /** 인라인 편집 중인 텍스트 — 서버 값보다 우선한다(디바운스 저장 중 덮어쓰기 방지) */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [week, setWeek] = useState(1);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dayRefs = useRef<Record<number, HTMLElement | null>>({});

  const exName = (ex: { name_ko: string; name_en: string } | null) =>
    ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : "—";

  const totalDays = initialDays.length;
  const perWeek =
    weekPattern && weekPattern.length
      ? weekPattern.length
      : weeks && weeks > 0
        ? Math.max(1, Math.ceil(totalDays / weeks))
        : 7;
  const weekOf = (dayIndex: number) => Math.ceil(dayIndex / perWeek);
  const weekCount = Math.max(1, weekOf(totalDays || 1));
  /** 주간 패턴이 있으면 N일차가 무슨 요일인지 알 수 있다 */
  const dowOf = (dayIndex: number) =>
    weekPattern && weekPattern.length
      ? dowLabel(tag, weekPattern[(dayIndex - 1) % weekPattern.length])
      : null;

  const itemCount = initialDays.reduce(
    (a, d) =>
      a + d.workout_templates.reduce((b, w) => b + w.workout_template_items.length, 0),
    0,
  );
  const workoutCount = initialDays.reduce(
    (a, d) => a + d.workout_templates.length,
    0,
  );
  const emptyWorkouts = initialDays.reduce(
    (a, d) =>
      a + d.workout_templates.filter((w) => !w.workout_template_items.length).length,
    0,
  );
  /** 구성된 일자 = 운동이 하나라도 들어간 워크아웃이 있는 날 (휴식일은 세지 않는다) */
  const filledDays = initialDays.filter((d) =>
    d.workout_templates.some((w) => w.workout_template_items.length > 0),
  ).length;
  const plannedDays = initialDays.filter((d) => d.workout_templates.length > 0).length;

  /** 모든 편집 mutation 의 공통 경로 — supabase-js 는 실패해도 throw 하지 않고
   *  {error} 로 resolve 하므로, 여기서 받아 화면에 알리지 않으면 무음 실패가 된다. */
  async function run(
    fn: () => PromiseLike<unknown>,
    opts: { refresh?: boolean } = {},
  ): Promise<boolean> {
    setBusy(true);
    setErr(null);
    const res = (await fn()) as { error?: { message: string } | null } | null;
    const e = Array.isArray(res)
      ? (res.find((r) => r?.error)?.error ?? null)
      : (res?.error ?? null);
    setBusy(false);
    if (e) {
      setErr(e.message);
      setSaved(false);
      return false;
    }
    setSaved(true);
    if (opts.refresh !== false) router.refresh();
    return true;
  }

  /** 인라인 편집은 타이핑이 멈춘 뒤에 저장한다. 화면은 draft 로 이미 맞으니
   *  refresh 하지 않는다 — 하면 커서가 튄다. */
  function queue(key: string, fn: () => PromiseLike<unknown>) {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      void run(fn, { refresh: false });
    }, 500);
  }

  const editText = (key: string, value: string, fn: () => PromiseLike<unknown>) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    queue(key, fn);
  };

  const setFocusText = (dayId: string, value: string) =>
    editText(`focus:${dayId}`, value, () =>
      supabase
        .from("program_days")
        .update({ focus: value.trim() || null })
        .eq("id", dayId),
    );

  const setWorkoutTitle = (id: string, value: string) =>
    editText(`title:${id}`, value, () =>
      supabase
        .from("workout_templates")
        .update({ title: value.trim() || t("programs.untitledWorkout") })
        .eq("id", id),
    );

  const nextIndex = () =>
    initialDays.reduce((m, d) => Math.max(m, d.day_index), 0) + 1;

  const addDay = (withWorkout: boolean) =>
    run(async () => {
      const { data, error } = await supabase
        .from("program_days")
        .insert({ program_id: programId, day_index: nextIndex() })
        .select("id")
        .single();
      if (error || !withWorkout) return { error };
      return await supabase.from("workout_templates").insert({
        program_day_id: data.id,
        title: t("programs.untitledWorkout"),
        type: "wod",
        structure: {},
      });
    });

  const delDay = (id: string, dayIndex: number) => {
    if (!window.confirm(t("programs.confirmDelDay", { n: dayIndex }))) return;
    return run(() => supabase.from("program_days").delete().eq("id", id));
  };

  const moveDay = (id: string, dir: -1 | 1) => {
    const idx = initialDays.findIndex((d) => d.id === id);
    const other = initialDays[idx + dir];
    if (idx < 0 || !other) return;
    const me = initialDays[idx];
    return run(() =>
      Promise.all([
        supabase.from("program_days").update({ day_index: other.day_index }).eq("id", me.id),
        supabase.from("program_days").update({ day_index: me.day_index }).eq("id", other.id),
      ]),
    );
  };

  /** 이번 주를 다음 주로 — 일자·워크아웃·항목을 그대로 복사한다.
   *  같은 주를 조금씩 바꿔 쓰는 게 프로그램 만들기의 대부분이라 이게 제일 크게 아낀다. */
  const copyWeek = async (w: number) => {
    const src = initialDays.filter((d) => weekOf(d.day_index) === w);
    if (!src.length) return;
    const dstIdx = src.map((d) => d.day_index + perWeek);
    const clash = initialDays.filter(
      (d) => dstIdx.includes(d.day_index) && d.workout_templates.length > 0,
    );
    if (clash.length && !window.confirm(t("programs.copyWeekConfirm", { n: clash.length })))
      return;
    await run(async () => {
      for (const d of src) {
        const target = initialDays.find((x) => x.day_index === d.day_index + perWeek);
        let dayId = target?.id;
        if (!dayId) {
          const { data, error } = await supabase
            .from("program_days")
            .insert({
              program_id: programId,
              day_index: d.day_index + perWeek,
              focus: d.focus,
            })
            .select("id")
            .single();
          if (error) return { error };
          dayId = data.id;
        } else {
          // 이미 있는 날이면 내용을 바꿔 끼운다 (확인은 위에서 받았다)
          const { error } = await supabase
            .from("program_days")
            .update({ focus: d.focus })
            .eq("id", dayId);
          if (error) return { error };
          for (const w0 of target!.workout_templates) {
            const { error: delErr } = await supabase
              .from("workout_templates")
              .delete()
              .eq("id", w0.id);
            if (delErr) return { error: delErr };
          }
        }
        for (const w0 of d.workout_templates) {
          const { data: created, error } = await supabase
            .from("workout_templates")
            .insert({
              program_day_id: dayId,
              title: w0.title,
              type: w0.type,
              structure: {},
            })
            .select("id")
            .single();
          if (error) return { error };
          if (w0.workout_template_items.length) {
            const { error: itemErr } = await supabase
              .from("workout_template_items")
              .insert(
                w0.workout_template_items.map((it) => ({
                  template_id: created.id,
                  seq: it.seq,
                  exercise_id: it.exercise_id,
                  target: it.target,
                })),
              );
            if (itemErr) return { error: itemErr };
          }
        }
      }
      return { error: null };
    });
  };

  const addWorkout = (dayId: string, type: string, autofillRaceSim: boolean) =>
    run(async () => {
      const { data: created, error } = await supabase
        .from("workout_templates")
        .insert({
          program_day_id: dayId,
          title: t("programs.untitledWorkout"),
          type,
          structure: {},
        })
        .select("id")
        .single();
      if (error) return { error };
      if (autofillRaceSim && created?.id) {
        return await supabase.from("workout_template_items").insert(
          RACE_SIM_SEQUENCE.map((exId, i) => ({
            template_id: created.id,
            seq: i + 1,
            exercise_id: exId,
            target: null,
          })),
        );
      }
      return { error: null };
    });

  const delWorkout = (id: string, title: string, items: number) => {
    if (items && !window.confirm(t("programs.confirmDelWorkout", { title }))) return;
    return run(() => supabase.from("workout_templates").delete().eq("id", id));
  };

  const setWorkoutType = (id: string, type: string) =>
    run(() => supabase.from("workout_templates").update({ type }).eq("id", id));

  const addItem = (w: Workout) => {
    const p = pick[w.id];
    if (!p?.ex) return;
    const num = (v: string | undefined) => {
      const n = Number((v ?? "").trim());
      return (v ?? "").trim() && Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const target: WorkoutTarget = {};
    for (const f of targetFieldsFor(exercises.find((e) => e.id === p.ex))) {
      const n = num(p.vals[f]);
      if (n != null)
        (target[TARGET_KEY[f]] as number) = f === "weight" ? n : Math.round(n);
    }
    if (p.note.trim()) target.note = p.note.trim();
    const nextSeq =
      w.workout_template_items.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
    return run(() =>
      supabase.from("workout_template_items").insert({
        template_id: w.id,
        seq: nextSeq,
        exercise_id: p.ex,
        target: Object.keys(target).length ? target : null,
      }),
    ).then((ok) => {
      // 실패하면 입력값을 지우지 않는다 (다시 입력하는 수고 방지)
      if (ok) setPick((s) => ({ ...s, [w.id]: { ...EMPTY_DRAFT } }));
    });
  };

  const delItem = (id: string) =>
    run(() => supabase.from("workout_template_items").delete().eq("id", id));

  /** 운동 순서 이동 — 이웃과 seq 를 맞바꾼다 (모바일에서도 되도록 버튼으로) */
  const moveItem = (w: Workout, id: string, dir: -1 | 1) => {
    const sorted = w.workout_template_items.slice().sort((a, b) => a.seq - b.seq);
    const i = sorted.findIndex((x) => x.id === id);
    const other = sorted[i + dir];
    if (i < 0 || !other) return;
    const me = sorted[i];
    return run(() =>
      Promise.all([
        supabase.from("workout_template_items").update({ seq: other.seq }).eq("id", me.id),
        supabase.from("workout_template_items").update({ seq: me.seq }).eq("id", other.id),
      ]),
    );
  };

  /** 운동 DB 에 없는 종목 — 관리자만 추가할 수 있으니 등록 요청으로 남긴다 */
  const requestExercise = async (name: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const ok = await run(
      () =>
        supabase
          .from("exercise_requests")
          .insert({ requested_by: user.id, name_ko: name.trim() }),
      { refresh: false },
    );
    if (ok) window.alert(t("programs.newExRequested", { q: name.trim() }));
  };

  const jumpToWeek = (w: number) => {
    setWeek(w);
    const first = initialDays.find((d) => weekOf(d.day_index) === w);
    if (first) dayRefs.current[first.day_index]?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="mt-4 flex flex-col gap-3 pb-[120px] max-md:pb-[150px]">
      {/* 저장 상태 */}
      <p className="flex items-center gap-1.5 self-end text-xs">
        {err ? (
          <span className="text-danger">{err}</span>
        ) : busy ? (
          <span className="text-muted">{t("common.saving")}</span>
        ) : saved ? (
          <span className="text-success">● {t("programs.autoSaved")}</span>
        ) : null}
      </p>

      {/* 주차 스트립 */}
      {totalDays > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => {
              const ds = initialDays.filter((d) => weekOf(d.day_index) === w);
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => jumpToWeek(w)}
                  className={`flex h-[34px] shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-bold transition-colors ${
                    week === w
                      ? "bg-accent text-background"
                      : "border border-line-strong text-[#c9c9c9] hover:border-muted/60"
                  }`}
                >
                  {t("programs.weekN", { n: w })}
                  <span className="flex gap-[3px]">
                    {ds.map((d) => {
                      const items = d.workout_templates.reduce(
                        (a, x) => a + x.workout_template_items.length,
                        0,
                      );
                      const tone = !d.workout_templates.length
                        ? week === w
                          ? "bg-background/30"
                          : "bg-[#333]"
                        : items > 0
                          ? week === w
                            ? "bg-background"
                            : "bg-accent"
                          : week === w
                            ? "bg-background/50"
                            : "bg-[#8a7a2a]";
                      return (
                        <span
                          key={d.id}
                          className={`h-[5px] w-[5px] rounded-full ${tone}`}
                        />
                      );
                    })}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => copyWeek(week)}
            disabled={busy}
            className="shrink-0 text-xs text-[#777] hover:text-foreground disabled:opacity-40 max-md:hidden"
          >
            {t("programs.copyWeek")} →
          </button>
        </div>
      )}

      {initialDays.map((d, i) => (
        <DayCard
          key={d.id}
          ref={(el: HTMLElement | null) => {
            dayRefs.current[d.day_index] = el;
          }}
          day={d}
          dow={dowOf(d.day_index)}
          dayDate={programDayDate(startDate, d.day_index, tag)}
          focusText={drafts[`focus:${d.id}`] ?? d.focus ?? ""}
          titleOf={(w) => drafts[`title:${w.id}`] ?? w.title}
          exercises={exercises}
          exName={exName}
          locale={locale}
          pick={pick}
          setPick={setPick}
          busy={busy}
          canUp={i > 0}
          canDown={i < initialDays.length - 1}
          onMove={(dir) => moveDay(d.id, dir)}
          onDelDay={() => delDay(d.id, d.day_index)}
          onFocusText={(v) => setFocusText(d.id, v)}
          onWorkoutTitle={setWorkoutTitle}
          onAddWorkout={(type, autofill) => addWorkout(d.id, type, autofill)}
          onSetWorkoutType={setWorkoutType}
          onDelWorkout={delWorkout}
          onAddItem={addItem}
          onDelItem={delItem}
          onMoveItem={moveItem}
          onRequestExercise={requestExercise}
        />
      ))}

      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => addDay(true)}
          disabled={busy}
          className="flex h-12 items-center justify-center rounded-[14px] border border-dashed border-line-strong text-sm font-semibold text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
        >
          + {t("programs.addDay")}
        </button>
        <button
          type="button"
          onClick={() => addDay(false)}
          disabled={busy}
          className="flex h-12 items-center justify-center rounded-[14px] border border-dashed border-line text-sm font-semibold text-[#777] transition-colors hover:border-muted hover:text-foreground disabled:opacity-50"
        >
          + {t("programs.addRest")}
        </button>
      </div>

      {/* 하단 고정 바 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-page/90 px-6 py-3 backdrop-blur max-md:bottom-[calc(62px+env(safe-area-inset-bottom))] max-md:px-4">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[13px] text-muted max-md:hidden">
            {t("programs.barCounts", {
              w: weekCount,
              d: totalDays,
              m: itemCount,
            })}
          </span>
          <span className="h-1.5 min-w-0 max-w-[280px] flex-1 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full rounded-full bg-accent transition-all"
              style={{
                width: `${plannedDays ? Math.round((filledDays / plannedDays) * 100) : 0}%`,
              }}
            />
          </span>
          <span className="tabular shrink-0 text-xs text-[#777]">
            {t("programs.fillLabel", { n: filledDays, m: plannedDays })}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="text-xs max-md:hidden">
              {emptyWorkouts > 0 ? (
                <span className="text-accent-dim">
                  {t("programs.emptyWods", { n: emptyWorkouts })}
                </span>
              ) : workoutCount > 0 ? (
                <span className="text-success">{t("programs.allWodsSet")}</span>
              ) : null}
            </span>
            {previewHref && (
              <Link
                href={previewHref}
                className="flex h-9 items-center rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold transition-colors hover:border-[#555]"
              >
                {t("programs.previewBtn")}
              </Link>
            )}
            {enrollSlot}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 일자 카드 — 머리글(일차·요일·포커스)과 그 날의 워크아웃들 */
function DayCard({
  ref,
  day,
  dow,
  dayDate,
  focusText,
  titleOf,
  exercises,
  exName,
  locale,
  pick,
  setPick,
  busy,
  canUp,
  canDown,
  onMove,
  onDelDay,
  onFocusText,
  onWorkoutTitle,
  onAddWorkout,
  onSetWorkoutType,
  onDelWorkout,
  onAddItem,
  onDelItem,
  onMoveItem,
  onRequestExercise,
}: {
  ref: (el: HTMLElement | null) => void;
  day: Day;
  dow: string | null;
  dayDate: string | null;
  focusText: string;
  titleOf: (w: Workout) => string;
  exercises: Exercise[];
  exName: (ex: { name_ko: string; name_en: string } | null) => string;
  locale: string;
  pick: Record<string, Draft>;
  setPick: React.Dispatch<React.SetStateAction<Record<string, Draft>>>;
  busy: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onDelDay: () => void;
  onFocusText: (v: string) => void;
  onWorkoutTitle: (id: string, v: string) => void;
  onAddWorkout: (type: string, autofillRaceSim: boolean) => void;
  onSetWorkoutType: (id: string, type: string) => void;
  onDelWorkout: (id: string, title: string, items: number) => void;
  onAddItem: (w: Workout) => void;
  onDelItem: (id: string) => void;
  onMoveItem: (w: Workout, id: string, dir: -1 | 1) => void;
  onRequestExercise: (name: string) => void;
}) {
  const { t } = useI18n();
  const items = day.workout_templates.reduce(
    (a, w) => a + w.workout_template_items.length,
    0,
  );
  const isRest = day.workout_templates.length === 0;

  const iconBtn =
    "flex h-7 w-7 items-center justify-center rounded-md border border-line-strong text-xs text-muted transition-colors hover:text-foreground disabled:opacity-25";

  return (
    <section
      ref={ref}
      className={`overflow-hidden rounded-[14px] border bg-card ${
        isRest ? "border-[#1c1c1c]" : "border-line"
      }`}
    >
      {/* 머리글 */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-inset px-4 py-3">
        <span className="text-[15px] font-extrabold">
          {t("programs.dayN", { n: day.day_index })}
        </span>
        {(dayDate || dow) && (
          <span className="text-xs text-[#777]">{dayDate ?? dow}</span>
        )}
        <input
          value={focusText}
          onChange={(e) => onFocusText(e.target.value)}
          placeholder={t("programs.focusPh")}
          maxLength={80}
          className={`${inlineCls} h-8 flex-1 text-sm max-md:order-last max-md:w-full max-md:flex-none`}
        />
        <span className="shrink-0 text-xs text-muted max-md:hidden">
          {t("programs.dayCounts", {
            w: day.workout_templates.length,
            m: items,
          })}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={busy || !canUp}
            aria-label={t("a11y.moveUp")}
            className={iconBtn}
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={busy || !canDown}
            aria-label={t("a11y.moveDown")}
            className={iconBtn}
          >
            ▼
          </button>
          <button
            type="button"
            onClick={onDelDay}
            disabled={busy}
            aria-label={t("common.delete")}
            className={`${iconBtn} hover:border-danger hover:text-danger`}
          >
            ✕
          </button>
        </span>
      </div>

      {/* 본문 */}
      {isRest ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-[13px] text-[#777]">{t("programs.restDay")}</span>
          <AddWorkoutButton
            busy={busy}
            compact
            onAdd={onAddWorkout}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 px-4 py-3">
          {day.workout_templates.map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w}
              title={titleOf(w)}
              exercises={exercises}
              exName={exName}
              locale={locale}
              draft={pick[w.id] ?? EMPTY_DRAFT}
              setDraft={(fn) =>
                setPick((s) => ({ ...s, [w.id]: fn(s[w.id] ?? EMPTY_DRAFT) }))
              }
              busy={busy}
              onTitle={(v) => onWorkoutTitle(w.id, v)}
              onSetType={(ty) => onSetWorkoutType(w.id, ty)}
              onDel={() =>
                onDelWorkout(w.id, titleOf(w), w.workout_template_items.length)
              }
              onAddItem={() => onAddItem(w)}
              onDelItem={onDelItem}
              onMoveItem={(id, dir) => onMoveItem(w, id, dir)}
              onRequestExercise={onRequestExercise}
            />
          ))}
          <AddWorkoutButton busy={busy} onAdd={onAddWorkout} />
        </div>
      )}
    </section>
  );
}

/** 워크아웃 추가 — 유형을 먼저 고르게 해서 한 번에 끝낸다 */
function AddWorkoutButton({
  busy,
  compact = false,
  onAdd,
}: {
  busy: boolean;
  compact?: boolean;
  onAdd: (type: string, autofillRaceSim: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className={
          compact
            ? "ml-auto flex h-8 items-center rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold transition-colors hover:border-[#555] disabled:opacity-50"
            : "flex h-9 items-center justify-center rounded-lg border border-dashed border-line-strong text-[13px] font-semibold text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
        }
      >
        + {t("programs.addWorkout")}
      </button>
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {WORKOUT_TYPES.map((ty) => (
        <button
          key={ty}
          type="button"
          disabled={busy}
          onClick={() => {
            const autofill =
              ty === "race_sim" ? window.confirm(t("programs.raceSimConfirm")) : false;
            onAdd(ty, autofill);
            setOpen(false);
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-control px-3 text-xs font-bold transition-colors hover:border-[#555] disabled:opacity-50"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${wodTypeDot(ty)}`} />
          {t(`programs.type.${ty}` as DictKey)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 text-xs text-muted hover:text-foreground"
      >
        {t("common.cancel")}
      </button>
    </div>
  );
}

/** 워크아웃 카드 — 제목·유형·운동 행·운동 추가 */
function WorkoutCard({
  workout: w,
  title,
  exercises,
  exName,
  locale,
  draft,
  setDraft,
  busy,
  onTitle,
  onSetType,
  onDel,
  onAddItem,
  onDelItem,
  onMoveItem,
  onRequestExercise,
}: {
  workout: Workout;
  title: string;
  exercises: Exercise[];
  exName: (ex: { name_ko: string; name_en: string } | null) => string;
  locale: string;
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  busy: boolean;
  onTitle: (v: string) => void;
  onSetType: (ty: string) => void;
  onDel: () => void;
  onAddItem: () => void;
  onDelItem: (id: string) => void;
  onMoveItem: (id: string, dir: -1 | 1) => void;
  onRequestExercise: (name: string) => void;
}) {
  const { t } = useI18n();
  const rows = w.workout_template_items.slice().sort((a, b) => a.seq - b.seq);
  // 대략의 소요 시간 — 정확할 필요는 없고 하루 분량이 감이 오면 된다
  const mins = rows.length ? rows.length * 6 + 5 : 0;

  return (
    <div className="rounded-xl border border-line bg-page">
      {/* 머리글 */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[#1c1c1c] px-3.5 py-2.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${wodTypeDot(w.type)}`} />
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          maxLength={80}
          placeholder={t("programs.workoutTitlePh")}
          className={`${inlineCls} h-8 min-w-24 flex-1 text-[15px] font-bold`}
        />
        <span className="flex shrink-0 items-center rounded-full border border-line-mid bg-card p-0.5 max-md:order-last">
          {WORKOUT_TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              disabled={busy}
              onClick={() => onSetType(ty)}
              className={`flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold transition-colors ${
                w.type === ty
                  ? "bg-accent text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t(`programs.type.${ty}` as DictKey)}
            </button>
          ))}
        </span>
        {mins > 0 && (
          <span className="tabular shrink-0 text-xs text-[#777]">
            {t("programs.aboutMin", { n: mins })}
          </span>
        )}
        <button
          type="button"
          onClick={onDel}
          disabled={busy}
          aria-label={t("common.delete")}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-xs text-muted transition-colors hover:text-danger disabled:opacity-40"
        >
          ✕
        </button>
      </div>

      {/* 운동 행 */}
      {rows.length ? (
        <ul>
          {rows.map((it, i) => (
            <li
              key={it.id}
              className="flex flex-wrap items-center gap-2.5 border-b border-[#161616] px-3.5 py-2 transition-colors last:border-b-0 hover:bg-[#111]"
            >
              <span className="tabular w-6 shrink-0 text-right text-xs font-bold text-[#777]">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {exName(it.exercises)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 max-md:order-last max-md:w-full max-md:pl-8">
                {targetParts(it.target, locale).map((part, j) => (
                  <span
                    key={j}
                    className="tabular flex h-6 items-center rounded-md border border-line-mid bg-[#161616] px-1.5 text-xs font-bold"
                  >
                    {part}
                  </span>
                ))}
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onMoveItem(it.id, -1)}
                  disabled={busy || i === 0}
                  aria-label={t("a11y.moveUp")}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-xs text-muted hover:text-foreground disabled:opacity-20"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => onMoveItem(it.id, 1)}
                  disabled={busy || i === rows.length - 1}
                  aria-label={t("a11y.moveDown")}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-xs text-muted hover:text-foreground disabled:opacity-20"
                >
                  ▼
                </button>
                <button
                  type="button"
                  onClick={() => onDelItem(it.id)}
                  disabled={busy}
                  aria-label={t("common.delete")}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-xs text-muted transition-colors hover:text-danger disabled:opacity-40"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-3 text-[13px] text-[#666]">{t("programs.noItems")}</p>
      )}

      <ExercisePicker
        exercises={exercises}
        exName={exName}
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        onAdd={onAddItem}
        onRequestExercise={onRequestExercise}
      />
    </div>
  );
}

/**
 * 운동 추가 — 검색해서 고르고, 그 운동에 맞는 처방 칸만 채워 넣는다.
 *
 * 예전엔 60개짜리 <select> 였다. 이름을 알아도 목록에서 찾는 데 시간이 더 걸려서
 * 검색으로 바꿨고, 고른 뒤에는 칸에 바로 커서가 가서 ↵ 로 연속 입력할 수 있다.
 */
function ExercisePicker({
  exercises,
  exName,
  draft,
  setDraft,
  busy,
  onAdd,
  onRequestExercise,
}: {
  exercises: Exercise[];
  exName: (ex: { name_ko: string; name_en: string } | null) => string;
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  busy: boolean;
  onAdd: () => void;
  onRequestExercise: (name: string) => void;
}) {
  const { t } = useI18n();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const picked = exercises.find((e) => e.id === draft.ex);
  const q = draft.q.trim().toLowerCase();
  const matches = (
    q
      ? exercises.filter(
          (e) =>
            e.name_ko.toLowerCase().includes(q) || e.name_en.toLowerCase().includes(q),
        )
      : exercises.filter((e) => QUICK_IDS.includes(e.id))
  ).slice(0, 20);

  const catLabel = (ex: Exercise) =>
    ex.station_type
      ? t("exercises.detStation")
      : ex.category && KNOWN_CATS.includes(ex.category)
        ? t(`exercises.cat.${ex.category}` as DictKey)
        : (ex.category ?? "—");

  const choose = (ex: Exercise) => {
    setDraft((d) => ({ ...d, ex: ex.id, q: "", open: false, hi: 0 }));
    // 고른 즉시 첫 처방 칸으로 — 검색 → 선택 → 숫자 → ↵ 가 한 흐름이 된다
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  };

  const fields = targetFieldsFor(picked);

  return (
    <div className="flex flex-col gap-2 bg-inset px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            ref={searchRef}
            value={draft.q}
            onChange={(e) =>
              setDraft((d) => ({ ...d, q: e.target.value, open: true, hi: 0 }))
            }
            onFocus={() => setDraft((d) => ({ ...d, open: true }))}
            onBlur={() =>
              // 항목을 클릭할 틈을 준다
              setTimeout(() => setDraft((d) => ({ ...d, open: false })), 120)
            }
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setDraft((d) => ({
                  ...d,
                  open: true,
                  hi: Math.max(
                    0,
                    Math.min(matches.length - 1, d.hi + (e.key === "ArrowDown" ? 1 : -1)),
                  ),
                }));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const hit = matches[draft.hi];
                if (hit) choose(hit);
                else if (draft.q.trim()) onRequestExercise(draft.q);
              } else if (e.key === "Escape") {
                setDraft((d) => ({ ...d, open: false }));
              }
            }}
            placeholder={t("programs.searchEx")}
            className="h-[38px] w-full rounded-lg border border-line-strong bg-page px-3 text-sm outline-none placeholder:text-[#555] focus:border-accent"
          />
          {draft.open && (
            <div className="absolute inset-x-0 top-[42px] z-20 max-h-80 overflow-y-auto rounded-[10px] border border-[#333] bg-[#1a1a1a] shadow-[0_16px_40px_rgba(0,0,0,.6)]">
              {matches.map((ex, i) => (
                <button
                  key={ex.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(ex)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                    i === draft.hi ? "bg-card-hover" : "hover:bg-card-hover"
                  }`}
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      CAT_CHIP[catOf(ex)] ?? "bg-line text-foreground/75"
                    }`}
                  >
                    {catLabel(ex)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {exName(ex)}
                  </span>
                  <span className="shrink-0 text-[11px] text-[#777]">
                    {targetFieldsFor(ex)
                      .slice(0, 2)
                      .map((f) => t(`programs.tgt.${f}` as DictKey))
                      .join(" · ")}
                  </span>
                </button>
              ))}
              {!matches.length && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onRequestExercise(draft.q)}
                  className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-card-hover"
                >
                  <span className="text-[13px] text-muted">
                    {t("exercises.noResults")}
                  </span>
                  <span className="text-[13px] font-bold text-accent">
                    {t("programs.newExFrom", { q: draft.q })}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {exercises
            .filter((e) => QUICK_IDS.includes(e.id))
            .map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => choose(ex)}
                className="flex h-[30px] items-center rounded-full border border-[#333] px-3 text-xs font-semibold text-muted transition-colors hover:border-muted hover:text-foreground"
              >
                + {exName(ex)}
              </button>
            ))}
        </div>
      </div>

      {/* 선택 확인 행 — 카테고리에 맞는 칸만 */}
      {picked && (
        <div className="grid gap-2 rounded-[10px] border border-line-accent bg-highlight p-2.5 md:grid-cols-[1.4fr_repeat(4,1fr)_1.4fr_auto]">
          <span className="flex min-w-0 flex-col justify-center">
            <span className="text-[10px] font-bold text-[#8a7a2a]">
              {t("programs.selectedEx")}
            </span>
            <span className="truncate text-sm font-bold">{exName(picked)}</span>
          </span>
          {fields.map((f, i) => (
            <label key={f} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[10px] text-muted">
                {t(`programs.tgt.${f}` as DictKey)}
              </span>
              <input
                ref={i === 0 ? firstFieldRef : undefined}
                value={draft.vals[f] ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    vals: { ...d.vals, [f]: e.target.value.replace(/[^0-9.]/g, "") },
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAdd();
                    setTimeout(() => searchRef.current?.focus(), 0);
                  } else if (e.key === "Escape") {
                    setDraft(() => ({ ...EMPTY_DRAFT }));
                  }
                }}
                inputMode="decimal"
                className="tabular h-9 min-w-0 rounded-lg border border-[#444] bg-page px-2 text-sm outline-none focus:border-accent"
              />
            </label>
          ))}
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] text-muted">{t("programs.targetPh")}</span>
            <input
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAdd();
                  setTimeout(() => searchRef.current?.focus(), 0);
                }
              }}
              maxLength={60}
              className="h-9 min-w-0 rounded-lg border border-[#444] bg-page px-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onAdd();
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
            disabled={busy}
            className="flex h-9 items-center justify-center self-end rounded-lg bg-accent px-3 text-[13px] font-extrabold text-background transition hover:brightness-110 disabled:opacity-40 max-md:w-full"
          >
            {t("programs.addItem")} ↵
          </button>
        </div>
      )}
    </div>
  );
}
