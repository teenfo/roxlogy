"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/lib/hyrox";
import { formatMs } from "@/lib/format";
import { useI18n } from "@/components/i18n-provider";
import { ChartFrame } from "@/components/chart-frame";

// 차트 안에서 쓰는 리터럴 — globals.css 토큰과 같은 값 (recharts 는 CSS 변수를
// 직접 못 받는다). card/line-mid/muted 에 맞춰 둔다.
const SURFACE = "#141414";
const GRID = "#2a2a2a";
const INK_MUTED = "#9A9A96";
const FAST = "#6ee7a0";
const SLOW = "#ff8a8a";

type TooltipPayload = {
  payload?: { name?: string; label?: string; ms?: number; kind?: string };
};

function DarkTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-muted/30 bg-background px-3 py-2 text-xs">
      <p className="text-muted">{p.name ?? p.label}</p>
      <p className="mt-0.5 font-mono font-semibold text-foreground">
        {formatMs(p.ms)}
      </p>
    </div>
  );
}

function LegendChips({ kinds }: { kinds: ("run" | "station" | "roxzone")[] }) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {kinds.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: CHART_COLORS[k] }}
          />
          {t(`kind.${k}`)}
        </span>
      ))}
    </div>
  );
}

/** 세그먼트별 스플릿 바 — kind 색으로 식별, 바별 호버 툴팁 */
export function SegmentSplitBars({
  data,
}: {
  data: { name: string; ms: number; kind: "run" | "station" | "roxzone" }[];
}) {
  const { t } = useI18n();
  const longest = data.reduce<(typeof data)[number] | null>(
    (m, d) => (m == null || d.ms > m.ms ? d : m),
    null,
  );
  const summary = longest
    ? t("chart.sumSplits", { n: data.length, name: longest.name, ms: formatMs(longest.ms) })
    : t("chart.noData");
  return (
    <ChartFrame
      summary={summary}
      columns={[t("chart.colSegment"), t("chart.colKind"), t("chart.colTime")]}
      rows={data.map((d) => [d.name, t(`kind.${d.kind}`), formatMs(d.ms)])}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval={2}
          />
          <YAxis
            tickFormatter={(v: number) => formatMs(v)}
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip content={<DarkTooltip />} cursor={{ fill: "#ffffff0d" }} />
          <Bar dataKey="ms" radius={[4, 4, 0, 0]} maxBarSize={22}>
            {data.map((d, i) => (
              <Cell key={i} fill={CHART_COLORS[d.kind]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <LegendChips kinds={["run", "station", "roxzone"]} />
    </ChartFrame>
  );
}

/** 랩 점 — 최고/최저만 색으로 구분 */
function LapDot(props: {
  cx?: number;
  cy?: number;
  value?: number;
  fastest: number | null;
  slowest: number | null;
}) {
  const { cx, cy, value, fastest, slowest } = props;
  if (cx == null || cy == null) return null;
  const fill =
    value != null && value === slowest && slowest !== fastest
      ? SLOW
      : value != null && value === fastest && slowest !== fastest
        ? FAST
        : CHART_COLORS.run;
  return (
    <circle cx={cx} cy={cy} r={4} fill={fill} stroke={SURFACE} strokeWidth={2} />
  );
}

/** 런 랩 페이스 추이 — 단일 시리즈 라인 (제목이 시리즈명, 범례 없음) */
export function RunLapLine({
  data,
}: {
  data: { name: string; ms: number }[];
}) {
  // 가장 빠른·느린 랩만 색을 달리한다 — 8개 점이 같은 색이면 어느 랩이
  // 무너졌는지 눈으로 찾아야 한다.
  const { t } = useI18n();
  const times = data.map((d) => d.ms);
  const fastest = times.length ? Math.min(...times) : null;
  const slowest = times.length ? Math.max(...times) : null;
  const fastName = data.find((d) => d.ms === fastest)?.name ?? "";
  const slowName = data.find((d) => d.ms === slowest)?.name ?? "";
  const summary =
    fastest != null && slowest != null
      ? t("chart.sumLaps", {
          n: data.length,
          fast: fastName,
          fastMs: formatMs(fastest),
          slow: slowName,
          slowMs: formatMs(slowest),
        })
      : t("chart.noData");

  return (
    <ChartFrame
      summary={summary}
      columns={[t("chart.colLap"), t("chart.colTime")]}
      rows={data.map((d) => [d.name, formatMs(d.ms)])}
    >
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: INK_MUTED, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tickFormatter={(v: number) => formatMs(v)}
          tick={{ fill: INK_MUTED, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={44}
          domain={["dataMin - 15000", "dataMax + 15000"]}
        />
        <Tooltip content={<DarkTooltip />} cursor={{ stroke: GRID }} />
        <Line
          type="monotone"
          dataKey="ms"
          stroke={CHART_COLORS.run}
          strokeWidth={2.5}
          dot={<LapDot fastest={fastest} slowest={slowest} />}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 런/스테이션/록스존 시간 비중 — 수평 스택바 (2px 서피스 갭 + 직접 라벨) */
export function BreakdownStackBar({
  runMs,
  stationMs,
  roxzoneMs,
}: {
  runMs: number;
  stationMs: number;
  roxzoneMs: number;
}) {
  const { t } = useI18n();
  const total = runMs + stationMs + roxzoneMs;
  if (!total) return null;
  const parts = [
    { kind: "run" as const, ms: runMs },
    { kind: "station" as const, ms: stationMs },
    { kind: "roxzone" as const, ms: roxzoneMs },
  ].filter((p) => p.ms > 0);

  return (
    <div>
      {/* 조각 값은 아래 텍스트 목록이 전달한다 — 막대는 장식(aria-hidden) */}
      <div aria-hidden className="flex h-7 w-full gap-[2px] overflow-hidden rounded-md">
        {parts.map((p) => (
          <div
            key={p.kind}
            style={{
              width: `${(p.ms / total) * 100}%`,
              background: CHART_COLORS[p.kind],
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((p) => (
          <span key={p.kind} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: CHART_COLORS[p.kind] }}
            />
            {t(`kind.${p.kind}`)} {Math.round((p.ms / total) * 100)}% ·{" "}
            <span className="font-mono">{formatMs(p.ms)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MultiTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null);
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-muted/30 bg-background px-3 py-2 text-xs">
      <p className="text-muted">{label}</p>
      {rows.map((p, i) => (
        <p key={i} className="mt-0.5 flex items-center gap-1.5 font-mono">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: p.color }}
          />
          <span className="text-muted">{p.name}</span>
          <span className="font-semibold text-foreground">
            {formatMs(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

/** 훈련(시뮬) 총시간 vs 레이스 총시간 시계열 — 두 시리즈 라인 (S16) */
export function CorrelationLine({
  data,
  simLabel,
  raceLabel,
}: {
  data: { date: string; sim: number | null; race: number | null }[];
  simLabel: string;
  raceLabel: string;
}) {
  const { t } = useI18n();
  const sims = data.filter((d) => d.sim != null).length;
  const races = data.filter((d) => d.race != null).length;
  return (
    <ChartFrame
      summary={t("chart.sumCorr", { sims, races, sim: simLabel, race: raceLabel })}
      columns={[t("chart.colDate"), simLabel, raceLabel]}
      rows={data.map((d) => [
        d.date,
        d.sim != null ? formatMs(d.sim) : "—",
        d.race != null ? formatMs(d.race) : "—",
      ])}
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            tickFormatter={(v: number) => formatMs(v)}
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={["dataMin - 60000", "dataMax + 60000"]}
          />
          <Tooltip content={<MultiTooltip />} cursor={{ stroke: GRID }} />
          <Line
            type="monotone"
            dataKey="sim"
            name={simLabel}
            stroke={CHART_COLORS.run}
            strokeWidth={2}
            connectNulls
            dot={{ r: 3, fill: CHART_COLORS.run, stroke: SURFACE, strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="race"
            name={raceLabel}
            stroke={CHART_COLORS.station}
            strokeWidth={2}
            connectNulls
            dot={{ r: 4, fill: CHART_COLORS.station, stroke: SURFACE, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: CHART_COLORS.run }}
          />
          {simLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: CHART_COLORS.station }}
          />
          {raceLabel}
        </span>
      </div>
    </ChartFrame>
  );
}

/** erg 세그먼트 파워/페이스 곡선 (S6) — 워커가 다운샘플(LTTB)한 시계열 */
export function ErgCurve({
  data,
  color,
  unit,
}: {
  data: { t: number; v: number }[];
  color: string;
  unit: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v: number) => `${Math.round(v)}s`}
          tick={{ fill: INK_MUTED, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tick={{ fill: INK_MUTED, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={40}
          domain={["dataMin", "dataMax"]}
        />
        <Tooltip
          cursor={{ stroke: GRID }}
          contentStyle={{
            background: "#141414",
            border: "1px solid #ffffff22",
            borderRadius: 6,
            fontSize: 12,
          }}
          labelFormatter={(v) => `${Math.round(Number(v))}s`}
          formatter={((v: number) => [`${v} ${unit}`, ""]) as never}
        />
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 대시보드 최근 세션 추이 — 단일 시리즈 미니 바 */
export function TrendBars({
  data,
}: {
  data: { name: string; ms: number }[];
}) {
  const { t } = useI18n();
  const best = data.length ? Math.min(...data.map((d) => d.ms)) : null;
  const last = data.length ? data[data.length - 1] : null;
  const summary =
    best != null && last
      ? t("chart.sumTrend", { n: data.length, last: formatMs(last.ms), best: formatMs(best) })
      : t("chart.noData");
  return (
    <ChartFrame
      summary={summary}
      columns={[t("chart.colDate"), t("chart.colTime")]}
      rows={data.map((d) => [d.name, formatMs(d.ms)])}
    >
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: INK_MUTED, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tickFormatter={(v: number) => formatMs(v)}
          tick={{ fill: INK_MUTED, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip content={<DarkTooltip />} cursor={{ fill: "#ffffff0d" }} />
        <Bar
          dataKey="ms"
          fill={CHART_COLORS.run}
          radius={[4, 4, 0, 0]}
          maxBarSize={18}
        />
      </BarChart>
    </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 에르그 스트로크별 힘 — 최대/평균 드라이브 힘 (lbs), x축 = 스트로크 번호 */
export function StrokeForceChart({
  data,
  peakLabel,
  avgLabel,
}: {
  data: { n: number; peak: number | null; avg: number | null }[];
  peakLabel: string;
  avgLabel: string;
}) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="n"
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: GRID }}
            contentStyle={{
              background: "#141414",
              border: "1px solid #ffffff22",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelFormatter={(v) => `#${v}`}
            formatter={((v: number, name: string) => [`${v} lbs`, name]) as never}
          />
          <Line
            type="monotone"
            dataKey="peak"
            name={peakLabel}
            stroke={CHART_COLORS.station}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="avg"
            name={avgLabel}
            stroke={CHART_COLORS.run}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS.station }} />
          {peakLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS.run }} />
          {avgLabel}
        </span>
      </div>
    </div>
  );
}

/** 에르그 드라이브 분석 — 스트로크별 드라이브/리커버리 시간 (초) */
export function DriveChart({
  data,
  driveLabel,
  recoverLabel,
}: {
  data: { n: number; drive: number | null; recover: number | null }[];
  driveLabel: string;
  recoverLabel: string;
}) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="n"
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => `${v}s`}
          />
          <Tooltip
            cursor={{ stroke: GRID }}
            contentStyle={{
              background: "#141414",
              border: "1px solid #ffffff22",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelFormatter={(v) => `#${v}`}
            formatter={((v: number, name: string) => [`${v}s`, name]) as never}
          />
          <Line
            type="monotone"
            dataKey="drive"
            name={driveLabel}
            stroke={CHART_COLORS.station}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="recover"
            name={recoverLabel}
            stroke="#35C26B"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS.station }} />
          {driveLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#35C26B" }} />
          {recoverLabel}
        </span>
      </div>
    </div>
  );
}
