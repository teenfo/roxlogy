// 필드 대비 백분위 (공개 집계 분포 기준). SQL race_percentile()과 동일 로직을
// 클라이언트에서 재사용해, 목록/대시보드에서 벤치마크를 한 번만 읽고 여러 레이스를
// 보간한다. 반환 = "상위 몇 %"(작을수록 빠름), 데이터 없으면 null.

export type Benchmark = {
  division: string;
  gender: string;
  scope: string;
  percentiles: Record<string, number>;
};

const LABELS = ["p10", "p25", "p50", "p75", "p90", "p99"] as const;
const PTILE = [10, 25, 50, 75, 90, 99];

export function percentileOf(
  totalMs: number | null | undefined,
  division: string | null | undefined,
  gender: string | null | undefined,
  benchmarks: Benchmark[],
  scope = "overall",
): number | null {
  if (totalMs == null || !division) return null;

  const pick = (g: string) =>
    benchmarks.find(
      (b) => b.division === division && b.gender === g && b.scope === scope,
    );
  const bm = pick(gender || "x") ?? pick("all");
  if (!bm) return null;
  const p = bm.percentiles;

  const t10 = p.p10;
  const t99 = p.p99;
  if (t10 == null || t99 == null) return null;
  if (totalMs <= t10) return round1(Math.max(1, (totalMs / t10) * 10));
  if (totalMs >= t99) return 99;

  for (let i = 0; i < LABELS.length - 1; i++) {
    const tPrev = p[LABELS[i]];
    const tCur = p[LABELS[i + 1]];
    if (tPrev == null || tCur == null) continue;
    if (totalMs >= tPrev && totalMs <= tCur) {
      const pPrev = PTILE[i];
      const pCur = PTILE[i + 1];
      const cdf =
        tCur === tPrev
          ? pCur
          : pPrev + ((pCur - pPrev) * (totalMs - tPrev)) / (tCur - tPrev);
      return round1(cdf);
    }
  }
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
