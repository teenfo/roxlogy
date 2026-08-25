import { getT } from "@/lib/i18n";
import { formatMs } from "@/lib/format";

/**
 * 필드 분포 곡선 — 실측 백분위(race_benchmarks)를 정규분포로 근사해
 * 곡선 위에 내 기록 위치를 표시한다. σ 는 p10–p90 스팬(2.5631σ)에서 유도.
 * 서버 컴포넌트 (순수 SVG, 상호작용 없음).
 */
export async function DistributionCurve({
  percentiles,
  myMs,
  pct,
  caption,
}: {
  percentiles: Record<string, number>;
  myMs: number;
  pct: number;
  caption: string;
}) {
  const { t } = await getT();
  const p10 = percentiles.p10;
  const p50 = percentiles.p50;
  const p90 = percentiles.p90;
  if (p10 == null || p50 == null || p90 == null) return null;

  const mu = p50;
  const sigma = Math.max(1, (p90 - p10) / 2.5631);
  const x0 = mu - 3 * sigma;
  const x1 = mu + 3 * sigma;

  const W = 320;
  const H = 96;
  const PAD_B = 18; // 하단 라벨 영역
  const curveH = H - PAD_B;

  const pts: string[] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    const y = Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
    const px = (i / N) * W;
    const py = curveH - y * (curveH - 8);
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  const path = `M0,${curveH} L${pts.join(" L")} L${W},${curveH} Z`;

  const toX = (v: number) =>
    Math.min(W - 2, Math.max(2, ((v - x0) / (x1 - x0)) * W));
  const myX = toX(myMs);
  const medX = toX(p50);

  return (
    <section className="mt-6 rounded-md bg-surface px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted">
          {t("dist.title")}
        </h2>
        <span className="text-xs font-bold text-accent">
          {t("dist.topPct", { pct })}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        role="img"
        aria-label={t("dist.title")}
      >
        {/* 분포 곡선 */}
        <path d={path} className="fill-track/15" />
        <polyline
          points={pts.join(" ")}
          fill="none"
          className="stroke-track/60"
          strokeWidth="1.5"
        />
        {/* 중앙값 */}
        <line
          x1={medX}
          y1={10}
          x2={medX}
          y2={curveH}
          className="stroke-muted/40"
          strokeDasharray="3 3"
        />
        <text
          x={medX}
          y={H - 5}
          textAnchor="middle"
          className="fill-current text-muted"
          fontSize="9"
        >
          {t("dist.median")} {formatMs(p50)}
        </text>
        {/* 내 기록 */}
        <line
          x1={myX}
          y1={4}
          x2={myX}
          y2={curveH}
          className="stroke-amber-400"
          strokeWidth="2"
        />
        <circle cx={myX} cy={4} r="3" className="fill-amber-400" />
        <text
          x={myX}
          y={H - 5}
          textAnchor={myX > W - 60 ? "end" : myX < 60 ? "start" : "middle"}
          className="fill-amber-400"
          fontSize="10"
          fontWeight="bold"
        >
          {formatMs(myMs)}
        </text>
        {/* 축 방향 안내 */}
        <text x={2} y={10} fontSize="8" className="fill-current text-muted">
          ← {t("dist.faster")}
        </text>
        <text
          x={W - 2}
          y={10}
          fontSize="8"
          textAnchor="end"
          className="fill-current text-muted"
        >
          {t("dist.slower")} →
        </text>
      </svg>
      <p className="mt-1 text-[11px] text-muted">{caption}</p>
    </section>
  );
}
