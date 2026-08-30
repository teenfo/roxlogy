// 필드 대비 백분위 (공개 집계 분포 기준). SQL race_percentile()과 동일 로직을
// 클라이언트에서 재사용해, 목록/대시보드에서 벤치마크를 한 번만 읽고 여러 레이스를
// 보간한다. 반환 = "상위 몇 %"(작을수록 빠름), 데이터 없으면 null.

export type Benchmark = {
  division: string;
  gender: string;
  scope: string;
  percentiles: Record<string, number>;
  /** 이 분포를 만든 완주 기록 수. null = 실측이 아닌 근사 베이스라인 */
  sample_size: number | null;
};

const LABELS = ["p10", "p25", "p50", "p75", "p90", "p99"] as const;
const PTILE = [10, 25, 50, 75, 90, 99];

/** 백분위를 보여줄 최소 표본 수.
 *
 *  분포는 p10~p99 여섯 앵커의 보간이라 표본이 얇으면 양 끝이 사실상 한두 명의
 *  기록에 좌우된다. 특히 pro·pro_doubles 는 실측이 아니라 근사 베이스라인
 *  (source='public-aggregate-baseline-v1 (approx)', sample_size=null)이어서
 *  "상위 99%" 같은 숫자가 근거 없이 나온다. 기준 미만이면 배지를 숨긴다. */
export const MIN_BENCHMARK_SAMPLE = 100;

/** 표본이 충분한 분포인가 (근사 베이스라인은 sample_size 가 null) */
function usable(b: Benchmark | undefined): b is Benchmark {
  return !!b && (b.sample_size ?? 0) >= MIN_BENCHMARK_SAMPLE;
}

/** 표본이 충분한 분포 고르기 — 성별 분포가 얇으면 'all' 로 내려간다.
 *  둘 다 기준 미달이면 undefined (백분위·분포곡선 모두 숨긴다).
 *  백분위와 곡선이 서로 다른 행을 쓰지 않도록 한 곳에서만 고른다. */
export function pickBenchmark(
  benchmarks: Benchmark[],
  division: string,
  gender: string | null | undefined,
  scope = "overall",
): Benchmark | undefined {
  const pick = (g: string) =>
    benchmarks.find(
      (b) => b.division === division && b.gender === g && b.scope === scope,
    );
  const byGender = pick(gender || "x");
  if (usable(byGender)) return byGender;
  const all = pick("all");
  return usable(all) ? all : undefined;
}

export function percentileOf(
  totalMs: number | null | undefined,
  division: string | null | undefined,
  gender: string | null | undefined,
  benchmarks: Benchmark[],
  scope = "overall",
): number | null {
  if (totalMs == null || !division) return null;

  const bm = pickBenchmark(benchmarks, division, gender, scope);
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

/** 출생연도 → HYROX 연령그룹 라벨 ("16-24", "25-29", … "70-74") */
export function hyroxAgeGroup(
  birthYear: number | null | undefined,
): string | null {
  if (!birthYear) return null;
  const age = new Date().getFullYear() - birthYear;
  if (age < 16 || age > 89) return null;
  if (age <= 24) return "16-24";
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}`;
}

/** 연령그룹 벤치마크(scope='age:그룹')가 있으면 그것을, 없으면 overall 폴백 */
export function percentileOfBest(
  totalMs: number | null | undefined,
  division: string | null | undefined,
  gender: string | null | undefined,
  ageGroup: string | null | undefined,
  benchmarks: Benchmark[],
): { pct: number; byAge: boolean } | null {
  if (ageGroup) {
    const p = percentileOf(totalMs, division, gender, benchmarks, `age:${ageGroup}`);
    if (p != null) return { pct: p, byAge: true };
  }
  const p = percentileOf(totalMs, division, gender, benchmarks, "overall");
  return p != null ? { pct: p, byAge: false } : null;
}
