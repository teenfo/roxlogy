import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 러닝 성격. 저하율 기준선은 최고 노력을 min() 으로 뽑으므로 종류로 거르지 않는다. */
export const RUN_KINDS = [
  { key: "easy", label: "run.kindEasy" },
  { key: "tempo", label: "run.kindTempo" },
  { key: "interval", label: "run.kindInterval" },
  { key: "long", label: "run.kindLong" },
  { key: "race", label: "run.kindRace" },
  { key: "other", label: "run.kindOther" },
] as const satisfies readonly { key: string; label: DictKey }[];

export const RUN_SURFACES = [
  { key: "treadmill", label: "run.surfTreadmill" },
  { key: "road", label: "run.surfRoad" },
  { key: "track", label: "run.surfTrack" },
  { key: "trail", label: "run.surfTrail" },
] as const satisfies readonly { key: string; label: DictKey }[];

export type RunKind = (typeof RUN_KINDS)[number]["key"];
export type RunSurface = (typeof RUN_SURFACES)[number]["key"];

export type Run = {
  id: string;
  ran_on: string;
  kind: RunKind;
  surface: RunSurface;
  distance_m: number;
  duration_ms: number;
  pace_s_per_km: number | string;
  incline_pct: number | string | null;
  avg_hr: number | null;
  max_hr: number | null;
  rpe: number | null;
  location: string | null;
  note: string | null;
};

export type RunSplit = {
  seq: number;
  distance_m: number;
  duration_ms: number;
  avg_hr: number | null;
};

export function kindLabel(kind: string): DictKey {
  return RUN_KINDS.find((k) => k.key === kind)?.label ?? "run.kindOther";
}

export function surfaceLabel(surface: string): DictKey {
  return RUN_SURFACES.find((s) => s.key === surface)?.label ?? "run.surfRoad";
}

/** 초/km → "4:32/km". 페이스는 DB 의 생성 컬럼이 권위이고 여기선 표시만 한다. */
export function formatPace(secPerKm: number | string | null | undefined): string {
  const s = typeof secPerKm === "string" ? Number(secPerKm) : secPerKm;
  if (s == null || !Number.isFinite(s) || s <= 0) return "—";
  const total = Math.round(s);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 거리(m) → "5.00km" / 1km 미만은 "800m". */
export function formatDistance(m: number): string {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(2)}km`;
}

/**
 * 리겔(Riegel) 환산 — T2 = T1 × (D2/D1)^1.06.
 * DB 의 run_1k_baseline 과 같은 식이다. 여기서는 입력 폼 미리보기용으로만 쓰고,
 * 실제 기준선은 항상 서버가 계산한 값을 표시한다.
 */
export const RIEGEL_EXP = 1.06;

export function riegelTo1kMs(distanceM: number, durationMs: number): number | null {
  if (distanceM < 800 || distanceM > 30000 || durationMs <= 0) return null;
  return durationMs * Math.pow(1000 / distanceM, RIEGEL_EXP);
}

export type Degradation = {
  session_id: string;
  sim_lap_avg_ms: number;
  laps: number;
  baseline: {
    baseline_1k_ms: number;
    from_run_id: string;
    from_distance_m: number;
    from_duration_ms: number;
    from_ran_on: string;
    sample_runs: number;
  } | null;
  degradation_pct: number | null;
  grade: "excellent" | "good" | "fair" | "weak" | null;
};

export function gradeClass(grade: Degradation["grade"]): string {
  switch (grade) {
    case "excellent":
      return "bg-emerald-500/15 text-emerald-400";
    case "good":
      return "bg-accent/15 text-accent";
    case "fair":
      return "bg-amber-500/15 text-amber-400";
    case "weak":
      return "bg-red-500/15 text-red-400";
    default:
      return "bg-surface text-muted";
  }
}

export function gradeDictKey(grade: Degradation["grade"]): DictKey {
  switch (grade) {
    case "excellent":
      return "run.gradeExcellent";
    case "good":
      return "run.gradeGood";
    case "fair":
      return "run.gradeFair";
    default:
      return "run.gradeWeak";
  }
}
