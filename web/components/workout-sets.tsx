"use client";

import { useI18n } from "@/components/i18n-provider";
import type { WorkoutTarget } from "@/lib/target";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 세트 한 줄 — 저장 전에는 id 가 없다 */
export type SetRow = {
  id: string | null;
  setNo: number;
  reps: number | null;
  weightKg: number | null;
  distanceM: number | null;
  durationS: number | null;
};

export type ItemSet = SetRow & { itemId: string };

const MAX_SETS = 50;

const num = (s: string, int = true): number | null => {
  const v = s.trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return int ? Math.round(n) : n;
};

/** 처방에 어떤 칸이 필요한지 — 없으면 횟수·무게를 기본으로 */
export function setColumns(target: WorkoutTarget | null | undefined) {
  const hasDist = !!target?.distance_m;
  const hasDur = !!target?.duration_s;
  const hasReps = !!target?.reps;
  if (!hasDist && !hasDur && !hasReps) return { reps: true, weight: true, dist: false, dur: false };
  return { reps: hasReps, weight: true, dist: hasDist, dur: hasDur };
}

/** 합계 한 줄 — "3세트 · 30회 · 최대 62.5kg" */
export function setsSummary(
  rows: SetRow[],
  t: (k: DictKey, v?: Record<string, string | number>) => string,
): string {
  const filled = rows.filter(
    (r) => r.reps != null || r.weightKg != null || r.distanceM != null || r.durationS != null,
  );
  if (filled.length === 0) return "";
  const parts: string[] = [t("workouts.setsN", { n: filled.length })];
  const reps = filled.reduce((a, r) => a + (r.reps ?? 0), 0);
  if (reps > 0) parts.push(t("workouts.totalReps", { n: reps }));
  const dist = filled.reduce((a, r) => a + (r.distanceM ?? 0), 0);
  if (dist > 0) parts.push(dist >= 1000 ? `${Number((dist / 1000).toFixed(2))}km` : `${dist}m`);
  const dur = filled.reduce((a, r) => a + (r.durationS ?? 0), 0);
  if (dur > 0) parts.push(dur >= 60 ? `${Math.round(dur / 60)}${t("workouts.minShort")}` : `${dur}s`);
  const weights = filled.map((r) => r.weightKg).filter((w): w is number => w != null);
  if (weights.length) parts.push(t("workouts.maxKg", { n: Math.max(...weights) }));
  return parts.join(" · ");
}

const CELL =
  "h-10 w-full rounded-lg border border-line-strong bg-page px-2 text-center text-sm tabular outline-none focus:border-accent";

/**
 * 세트별 기록 표 — 종목 하나에 세트를 여러 줄로 적는다.
 * 처방에 있는 칸(횟수·무게·거리·시간)만 보여 주고, 합계는 아래에 한 줄로.
 */
export function WorkoutSetEditor({
  rows,
  target,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  rows: SetRow[];
  target: WorkoutTarget | null;
  pending: boolean;
  onChange: (rows: SetRow[]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const col = setColumns(target);
  const cols = 1 + (col.reps ? 1 : 0) + (col.weight ? 1 : 0) + (col.dist ? 1 : 0) + (col.dur ? 1 : 0);

  const patch = (i: number, p: Partial<SetRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const addSet = () => {
    if (rows.length >= MAX_SETS) return;
    const last = rows[rows.length - 1];
    onChange([
      ...rows,
      {
        id: null,
        setNo: (last?.setNo ?? 0) + 1,
        // 직전 세트의 무게를 이어받는다 — 대개 같은 무게로 이어 간다
        reps: null,
        weightKg: last?.weightKg ?? null,
        distanceM: null,
        durationS: null,
      },
    ]);
  };

  const removeSet = (i: number) =>
    onChange(rows.filter((_, j) => j !== i).map((r, j) => ({ ...r, setNo: j + 1 })));

  return (
    // 넓은 화면에서 입력 칸이 끝까지 늘어나면 숫자 하나 적기에 과하게 넓다
    <div className="flex max-w-[560px] flex-col gap-2.5">
      {/* 열 제목 */}
      <div
        className="grid items-center gap-2 text-[11px] font-bold tracking-[0.04em] text-muted"
        style={{ gridTemplateColumns: `36px repeat(${cols - 1}, minmax(0,1fr)) 36px` }}
      >
        <span>{t("workouts.setCol")}</span>
        {col.reps && <span className="text-center">{t("workouts.reps")}</span>}
        {col.weight && <span className="text-center">{t("workouts.kg")}</span>}
        {col.dist && <span className="text-center">{t("workouts.meters")}</span>}
        {col.dur && <span className="text-center">{t("workouts.seconds")}</span>}
        <span />
      </div>

      {rows.map((r, i) => (
        <div
          key={`${r.id ?? "new"}-${r.setNo}`}
          className="grid items-center gap-2"
          style={{ gridTemplateColumns: `36px repeat(${cols - 1}, minmax(0,1fr)) 36px` }}
        >
          <span className="tabular text-sm font-extrabold text-muted">{r.setNo}</span>
          {col.reps && (
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              aria-label={t("workouts.setRepsLabel", { n: r.setNo })}
              value={r.reps ?? ""}
              onChange={(e) => patch(i, { reps: num(e.target.value) })}
              className={CELL}
            />
          )}
          {col.weight && (
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              aria-label={t("workouts.setWeightLabel", { n: r.setNo })}
              value={r.weightKg ?? ""}
              onChange={(e) => patch(i, { weightKg: num(e.target.value, false) })}
              className={CELL}
            />
          )}
          {col.dist && (
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="10"
              aria-label={t("workouts.setDistLabel", { n: r.setNo })}
              value={r.distanceM ?? ""}
              onChange={(e) => patch(i, { distanceM: num(e.target.value) })}
              className={CELL}
            />
          )}
          {col.dur && (
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="5"
              aria-label={t("workouts.setDurLabel", { n: r.setNo })}
              value={r.durationS ?? ""}
              onChange={(e) => patch(i, { durationS: num(e.target.value) })}
              className={CELL}
            />
          )}
          <button
            type="button"
            onClick={() => removeSet(i)}
            aria-label={t("workouts.removeSet", { n: r.setNo })}
            className="flex h-10 w-9 items-center justify-center rounded-lg text-muted hover:text-danger"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addSet}
          disabled={rows.length >= MAX_SETS}
          className="h-10 rounded-lg border border-line-strong bg-control px-3.5 text-[13px] font-semibold hover:border-muted/60 disabled:opacity-40"
        >
          + {t("workouts.addSet")}
        </button>
        <span className="tabular text-[13px] text-success">{setsSummary(rows, t)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="h-10 rounded-lg bg-accent px-5 text-sm font-extrabold text-on-accent hover:brightness-110 disabled:opacity-40"
        >
          {pending ? t("workouts.saving") : t("workouts.saveLog")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-lg px-3 text-sm text-muted hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
