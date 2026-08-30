/** 워크아웃 아이템 처방(target) — 통계 집계를 위해 숫자 필드로 구조화.
 *  표시 문자열은 여기서 조립한다. note 는 숫자로 담기지 않는 나머지. */
export type WorkoutTarget = {
  distance_m?: number | null;
  weight_kg?: number | null;
  reps?: number | null;
  sets?: number | null;
  duration_s?: number | null;
  note?: string | null;
};

const LABELS: Record<string, { reps: string; sets: string; min: string; sec: string }> = {
  ko: { reps: "회", sets: "세트", min: "분", sec: "초" },
  en: { reps: " reps", sets: " sets", min: "min", sec: "s" },
  es: { reps: " reps", sets: " series", min: "min", sec: "s" },
};

/** 예: {distance_m:400, sets:8, note:"세트간 90초 휴식"} → "400m × 8세트 — 세트간 90초 휴식" */
export function formatTarget(
  target: WorkoutTarget | null | undefined,
  locale: string,
): string | null {
  if (!target) return null;
  const l = LABELS[locale] ?? LABELS.en;
  const parts: string[] = [];
  if (target.distance_m)
    parts.push(
      target.distance_m >= 1000
        ? `${Number((target.distance_m / 1000).toFixed(2))}km`
        : `${target.distance_m}m`,
    );
  if (target.weight_kg) parts.push(`${target.weight_kg}kg`);
  if (target.reps) parts.push(`${target.reps}${l.reps}`);
  if (target.duration_s)
    parts.push(
      target.duration_s >= 60 && target.duration_s % 60 === 0
        ? `${target.duration_s / 60}${l.min}`
        : `${target.duration_s}${l.sec}`,
    );
  let main = parts.join(" · ");
  if (target.sets)
    main = main ? `${main} × ${target.sets}${l.sets}` : `${target.sets}${l.sets}`;
  const note = target.note?.trim();
  if (note) main = main ? `${main} — ${note}` : note;
  return main || null;
}
