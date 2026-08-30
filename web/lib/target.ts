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

/** 처방을 개별 배지 문자열 배열로.
 *  예: {distance_m:400, sets:8, note:"세트간 90초 휴식"}
 *    → ["400m", "8세트", "세트간 90초 휴식"] */
export function targetParts(
  target: WorkoutTarget | null | undefined,
  locale: string,
): string[] {
  if (!target) return [];
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
  if (target.sets) parts.push(`${target.sets}${l.sets}`);
  const note = target.note?.trim();
  if (note) parts.push(note);
  return parts;
}

/** 처방을 한 문장으로 (배지 분리가 어려운 자리용).
 *  예: "400m × 8세트 — 세트간 90초 휴식" */
export function formatTarget(
  target: WorkoutTarget | null | undefined,
  locale: string,
): string | null {
  if (!target) return null;
  const l = LABELS[locale] ?? LABELS.en;
  const scale = targetParts(
    { ...target, sets: undefined, note: undefined },
    locale,
  );
  let main = scale.join(" · ");
  if (target.sets)
    main = main ? `${main} × ${target.sets}${l.sets}` : `${target.sets}${l.sets}`;
  const note = target.note?.trim();
  if (note) main = main ? `${main} — ${note}` : note;
  return main || null;
}
