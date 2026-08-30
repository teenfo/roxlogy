"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";

/**
 * 레이스 세그먼트(런 랩 8 + 스테이션 8) 표 — 각 세그먼트를 클릭하면
 * 스플릿별 필드 순위(place/field_size)를 정규분포 곡선 위 위치로 보여주는
 * 모달을 띄운다. place 데이터는 공식 기록 자동 임포트가 채운다.
 */

export type ReplayRow = {
  i: number; // 1..8
  runMs: number | null;
  runPlace: number | null;
  roxMs: number | null;
  stationKey: string;
  stationLabel: string;
  stMs: number | null;
  stPlace: number | null;
};

export type SegHistoryPoint = { date: string; ms: number };

type Selected = {
  key: string; // "run_1".."run_8" | station key
  label: string;
  ms: number;
  place: number | null;
};

/** 표준정규 역CDF (Acklam 근사) — place 백분위를 곡선 위 x 좌표로 변환 */
function invNorm(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p));
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143,
    3.75440866190742];
  const pl = 0.02425;
  if (q < pl) {
    const u = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * u + c[1]) * u + c[2]) * u + c[3]) * u + c[4]) * u + c[5]) /
      ((((d[0] * u + d[1]) * u + d[2]) * u + d[3]) * u + 1);
  }
  if (q > 1 - pl) return -invNorm(1 - q);
  const u = q - 0.5;
  const r = u * u;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * u /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** 정규분포 곡선 + 내 위치 마커 (place 기반 실측 백분위) */
function SegmentCurve({
  place,
  field,
  myMs,
}: {
  place: number;
  field: number;
  myMs: number;
}) {
  const { t } = useI18n();
  const W = 300;
  const H = 90;
  const PAD_B = 16;
  const curveH = H - PAD_B;

  const pts: string[] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const z = -3 + (6 * i) / N;
    const y = Math.exp(-(z * z) / 2);
    pts.push(`${((i / N) * W).toFixed(1)},${(curveH - y * (curveH - 8)).toFixed(1)}`);
  }
  const path = `M0,${curveH} L${pts.join(" L")} L${W},${curveH} Z`;

  // 내 위치: q = 필드에서 나보다 빠른(≤) 비율 ≈ place/field, 왼쪽=빠름
  const q = place / field;
  const z = Math.min(2.85, Math.max(-2.85, invNorm(q)));
  const myX = Math.min(W - 2, Math.max(2, ((z + 3) / 6) * W));
  const medX = W / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 w-full"
      role="img"
      aria-label={t("dist.title")}
    >
      <path d={path} className="fill-track/15" />
      <polyline
        points={pts.join(" ")}
        fill="none"
        className="stroke-track/60"
        strokeWidth="1.5"
      />
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
        y={H - 4}
        textAnchor="middle"
        className="fill-current text-muted"
        fontSize="9"
      >
        {t("dist.median")}
      </text>
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
        y={H - 4}
        textAnchor={myX > W - 55 ? "end" : myX < 55 ? "start" : "middle"}
        className="fill-amber-400"
        fontSize="10"
        fontWeight="bold"
      >
        {formatMs(myMs)}
      </text>
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
  );
}

/** 같은 세그먼트의 내 레이스 기록 추이 스파크라인 */
function HistorySpark({ points }: { points: SegHistoryPoint[] }) {
  const W = 300;
  const H = 64;
  const PAD = 8;
  const min = Math.min(...points.map((p) => p.ms));
  const max = Math.max(...points.map((p) => p.ms));
  const span = Math.max(1, max - min);
  const x = (i: number) =>
    points.length === 1
      ? W / 2
      : PAD + ((W - 2 * PAD) * i) / (points.length - 1);
  const y = (ms: number) => PAD + ((H - 2 * PAD) * (ms - min)) / span;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.ms).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      {points.length > 1 && (
        <polyline
          points={line.join(" ")}
          fill="none"
          className="stroke-accent/70"
          strokeWidth="1.5"
        />
      )}
      {points.map((p, i) => (
        <g key={`${p.date}-${i}`}>
          <circle cx={x(i)} cy={y(p.ms)} r="3" className="fill-accent" />
          <text
            x={x(i)}
            y={y(p.ms) - 6}
            textAnchor="middle"
            fontSize="8"
            className="fill-current text-muted"
          >
            {formatMs(p.ms)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function RaceReplayTable({
  rows,
  fieldSize,
  history,
}: {
  rows: ReplayRow[];
  fieldSize: number | null;
  history: Record<string, SegHistoryPoint[]>;
}) {
  const { t, tag } = useI18n();
  const [sel, setSel] = useState<Selected | null>(null);

  const cellBtn =
    "cursor-pointer rounded px-1 py-0.5 text-accent underline decoration-accent/40 decoration-dotted underline-offset-2 hover:bg-accent/10";

  const openRun = (r: ReplayRow) =>
    r.runMs != null &&
    setSel({
      key: `run_${r.i}`,
      label: `${t("races.colRun")} ${r.i}`,
      ms: r.runMs,
      place: r.runPlace,
    });
  const openStation = (r: ReplayRow) =>
    r.stMs != null &&
    setSel({
      key: r.stationKey,
      label: r.stationLabel,
      ms: r.stMs,
      place: r.stPlace,
    });

  const selHistory = sel ? (history[sel.key] ?? []) : [];
  const topPct =
    sel?.place != null && fieldSize
      ? Math.max(1, Math.round((sel.place / fieldSize) * 100))
      : null;

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface text-left text-xs text-muted">
            <th className="py-2 pr-4 font-normal">#</th>
            <th className="py-2 pr-4 text-right font-normal">
              {t("races.colRun")}
            </th>
            <th className="py-2 pr-4 text-right font-normal">
              {t("races.colRoxzone")}
            </th>
            <th className="py-2 pr-4 font-normal">{t("races.colStation")}</th>
            <th className="py-2 text-right font-normal">
              {t("races.colStationTime")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stationKey} className="border-b border-surface/60">
              <td className="py-2.5 pr-4 font-mono text-xs text-muted">{r.i}</td>
              <td className="py-2.5 pr-4 text-right font-mono">
                {r.runMs != null ? (
                  <button
                    type="button"
                    className={cellBtn}
                    onClick={() => openRun(r)}
                  >
                    {formatMs(r.runMs)}
                  </button>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted">
                {r.roxMs != null ? formatMs(r.roxMs) : "—"}
              </td>
              <td className="py-2.5 pr-4">
                {r.stMs != null ? (
                  <button
                    type="button"
                    className={cellBtn}
                    onClick={() => openStation(r)}
                  >
                    {r.stationLabel}
                  </button>
                ) : (
                  r.stationLabel
                )}
              </td>
              <td className="py-2.5 text-right font-mono">
                {r.stMs != null ? (
                  <button
                    type="button"
                    className={cellBtn}
                    onClick={() => openStation(r)}
                  >
                    {formatMs(r.stMs)}
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">{t("races.replayNote")}</p>
      <p className="mt-1 text-xs text-muted">{t("races.replayClickNote")}</p>

      {sel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSel(null)}
        >
          <div
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-lg bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-base font-bold">{sel.label}</h3>
              <span className="font-mono text-lg font-bold text-accent">
                {formatMs(sel.ms)}
              </span>
            </div>

            {sel.place != null && fieldSize ? (
              <>
                <p className="mt-1.5 text-sm text-muted">
                  {t("races.segPlace", {
                    place: sel.place.toLocaleString(tag),
                    field: fieldSize.toLocaleString(tag),
                  })}
                  {topPct != null && (
                    <span className="ml-2 font-bold text-accent">
                      {t("dist.topPct", { pct: topPct })}
                    </span>
                  )}
                </p>
                <SegmentCurve place={sel.place} field={fieldSize} myMs={sel.ms} />
                <p className="mt-1 text-[11px] text-muted">
                  {t("races.segDistNote", {
                    field: fieldSize.toLocaleString(tag),
                  })}
                </p>
              </>
            ) : sel.place != null ? (
              <p className="mt-1.5 text-sm text-muted">
                {t("races.segPlaceOnly", {
                  place: sel.place.toLocaleString(tag),
                })}
              </p>
            ) : (
              <p className="mt-2 rounded-md bg-background px-3 py-3 text-xs text-muted">
                {t("races.segNoPlace")}
              </p>
            )}

            {selHistory.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-muted">
                  {t("races.segHistory")}
                </h4>
                <HistorySpark points={selHistory} />
                <div className="mt-0.5 flex justify-between text-[10px] text-muted">
                  <span>{selHistory[0]?.date}</span>
                  {selHistory.length > 1 && (
                    <span>{selHistory[selHistory.length - 1]?.date}</span>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              className="mt-5 w-full rounded-md bg-background py-2 text-sm font-semibold hover:bg-background/70"
              onClick={() => setSel(null)}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
