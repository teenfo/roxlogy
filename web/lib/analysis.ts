/**
 * 세션 파생 지표 — 웹 즉석 계산.
 * hosub 워커(S5)가 동일 수식으로 session_metrics를 채우기 전까지의
 * 기준 구현이자, 이후에도 워커 수식과 일치해야 하는 정의부.
 */

export type SegmentLike = {
  kind: string;
  split_time_ms: number | null;
};

export type Breakdown = {
  runMs: number;
  stationMs: number;
  roxzoneMs: number;
  totalMs: number;
};

export function breakdown(segments: SegmentLike[]): Breakdown {
  const sum = (kind: string) =>
    segments
      .filter((s) => s.kind === kind)
      .reduce((acc, s) => acc + (s.split_time_ms ?? 0), 0);
  const runMs = sum("run");
  const stationMs = sum("station");
  const roxzoneMs = sum("roxzone");
  return { runMs, stationMs, roxzoneMs, totalMs: runMs + stationMs + roxzoneMs };
}

/** 런 랩 편차 = 모표준편차(ms). 랩 2개 미만이면 null */
export function runLapDeviationMs(segments: SegmentLike[]): number | null {
  const laps = segments
    .filter((s) => s.kind === "run" && s.split_time_ms != null)
    .map((s) => s.split_time_ms!) ;
  if (laps.length < 2) return null;
  const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
  const variance =
    laps.reduce((acc, l) => acc + (l - mean) ** 2, 0) / laps.length;
  return Math.round(Math.sqrt(variance));
}

export type PacingGrade =
  | "very_consistent"
  | "consistent"
  | "variable"
  | "erratic";

/** 랩 편차 → 페이싱 등급 (Roxlab Pacing 벤치마크 기준의 등급 구간) */
export function pacingGrade(deviationMs: number): PacingGrade {
  if (deviationMs < 10_000) return "very_consistent";
  if (deviationMs < 20_000) return "consistent";
  if (deviationMs < 35_000) return "variable";
  return "erratic";
}

export const PACING_GRADE_LABEL: Record<PacingGrade, string> = {
  very_consistent: "매우 일정",
  consistent: "일정",
  variable: "기복 있음",
  erratic: "불안정",
};

/** 가장 긴 록스존 트랜지션 (없으면 null) */
export function longestRoxzone(
  segments: (SegmentLike & { seq?: number })[],
): { seq?: number; ms: number } | null {
  const zones = segments.filter(
    (s) => s.kind === "roxzone" && s.split_time_ms != null,
  );
  if (!zones.length) return null;
  const top = zones.reduce((a, b) =>
    (b.split_time_ms ?? 0) > (a.split_time_ms ?? 0) ? b : a,
  );
  return { seq: top.seq, ms: top.split_time_ms! };
}
