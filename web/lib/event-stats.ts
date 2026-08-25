/** 대회 디비전 실측 통계 — 서버/클라이언트 공용 순수 타입·계산. */

export type EventDivisionStat = {
  label: string; // API 디비전 이름 (예: "HYROX PRO - Saturday")
  count: number;
  medianMs: number | null;
  p10Ms: number | null;
  p25Ms: number | null;
  p75Ms: number | null;
  p90Ms: number | null;
};

/** API 디비전 라벨 → 우리 디비전 코드 */
export function mapApiDivision(label: string | null | undefined): string | null {
  const k = String(label ?? "").toUpperCase();
  if (!k) return null;
  if (/MIXED\s+DOUBLES/.test(k)) return "mixed_doubles";
  if (/PRO\s+DOUBLES/.test(k)) return "pro_doubles";
  if (/DOUBLES/.test(k)) return "doubles";
  if (/RELAY/.test(k)) return "relay";
  if (/PRO/.test(k)) return "pro";
  if (/HYROX/.test(k)) return "open";
  return null;
}

/** p10~p90 브레이크포인트에서 목표 시간의 백분위 보간 (상위 %) */
export function percentileWithin(
  targetMs: number,
  s: EventDivisionStat,
): number | null {
  const pts: [number, number][] = [];
  if (s.p10Ms != null) pts.push([10, s.p10Ms]);
  if (s.p25Ms != null) pts.push([25, s.p25Ms]);
  if (s.medianMs != null) pts.push([50, s.medianMs]);
  if (s.p75Ms != null) pts.push([75, s.p75Ms]);
  if (s.p90Ms != null) pts.push([90, s.p90Ms]);
  if (pts.length < 2) return null;
  if (targetMs <= pts[0][1])
    return Math.max(1, Math.round((targetMs / pts[0][1]) * pts[0][0]));
  const last = pts[pts.length - 1];
  if (targetMs >= last[1]) return last[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [pA, tA] = pts[i];
    const [pB, tB] = pts[i + 1];
    if (targetMs >= tA && targetMs <= tB) {
      const cdf = tB === tA ? pB : pA + ((pB - pA) * (targetMs - tA)) / (tB - tA);
      return Math.round(cdf);
    }
  }
  return null;
}
