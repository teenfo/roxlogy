/** 워크아웃 아이템 처방(target) — 통계 집계를 위해 숫자 필드로 구조화.
 *  표시 문자열은 여기서 조립한다. note 는 숫자로 담기지 않는 나머지. */
export type WorkoutTarget = {
  distance_m?: number | null;
  weight_kg?: number | null;
  reps?: number | null;
  sets?: number | null;
  duration_s?: number | null;
  /** 세트 사이 휴식. 처방에서 제일 자주 빠뜨리는 값이라 칸을 따로 뒀다 */
  rest_s?: number | null;
  note?: string | null;
};

const LABELS: Record<
  string,
  { reps: string; sets: string; min: string; sec: string; rest: string }
> = {
  ko: { reps: "회", sets: "세트", min: "분", sec: "초", rest: "휴식 " },
  en: { reps: " reps", sets: " sets", min: "min", sec: "s", rest: "rest " },
  es: { reps: " reps", sets: " series", min: "min", sec: "s", rest: "desc. " },
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
  if (target.rest_s)
    parts.push(
      target.rest_s >= 60 && target.rest_s % 60 === 0
        ? `${l.rest}${target.rest_s / 60}${l.min}`
        : `${l.rest}${target.rest_s}${l.sec}`,
    );
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
    { ...target, sets: undefined, rest_s: undefined, note: undefined },
    locale,
  );
  let main = scale.join(" · ");
  if (target.sets)
    main = main ? `${main} × ${target.sets}${l.sets}` : `${target.sets}${l.sets}`;
  if (target.rest_s) {
    const rest =
      target.rest_s >= 60 && target.rest_s % 60 === 0
        ? `${l.rest}${target.rest_s / 60}${l.min}`
        : `${l.rest}${target.rest_s}${l.sec}`;
    main = main ? `${main} · ${rest}` : rest;
  }
  const note = target.note?.trim();
  if (note) main = main ? `${main} — ${note}` : note;
  return main || null;
}

/** 처방 입력 칸 — WorkoutTarget 의 숫자 키. note 는 따로 받는다. */
export type TargetField =
  | "distance"
  | "weight"
  | "reps"
  | "sets"
  | "duration"
  | "rest";

/** 종목 성격에 맞는 처방 칸.
 *
 *  네 칸을 항상 같은 자리에 두는 게 연속 입력에 유리해서, 성격별로 "쓰는 칸"만
 *  다르게 고르고 나머지는 화면에서 흐리게 둔다. 스테이션·유산소는 거리와 시간,
 *  근력·코어·재활은 횟수와 무게가 기본이다. */
export function targetFieldsFor(
  ex: { station_type?: string | null; category?: string | null } | undefined,
): TargetField[] {
  if (!ex) return [];
  if (ex.station_type) return ["distance", "duration", "sets", "rest"];
  switch (ex.category) {
    case "running":
    case "cardio":
      return ["distance", "duration", "sets", "rest"];
    case "strength":
    case "core":
      return ["reps", "sets", "weight", "rest"];
    case "mobility":
    case "rehab":
      return ["reps", "sets", "duration", "rest"];
    case "conditioning":
      return ["distance", "reps", "sets", "rest"];
    default:
      return ["reps", "sets", "weight", "rest"];
  }
}

/** 입력 칸 → target 키 */
export const TARGET_KEY: Record<TargetField, keyof WorkoutTarget> = {
  distance: "distance_m",
  weight: "weight_kg",
  reps: "reps",
  sets: "sets",
  duration: "duration_s",
  rest: "rest_s",
};
