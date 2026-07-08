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

const SURFACE = "#1E1E1E";
const GRID = "#2C2C2A";
const INK_MUTED = "#9A9A96";

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
    <div className="mt-2 flex gap-4 text-xs text-muted">
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
  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: INK_MUTED, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval={2}
          />
          <YAxis
            tickFormatter={(v: number) => formatMs(v)}
            tick={{ fill: INK_MUTED, fontSize: 10 }}
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
    </div>
  );
}

/** 런 랩 페이스 추이 — 단일 시리즈 라인 (제목이 시리즈명, 범례 없음) */
export function RunLapLine({
  data,
}: {
  data: { name: string; ms: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: INK_MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tickFormatter={(v: number) => formatMs(v)}
          tick={{ fill: INK_MUTED, fontSize: 10 }}
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
          strokeWidth={2}
          dot={{ r: 4, fill: CHART_COLORS.run, stroke: SURFACE, strokeWidth: 2 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
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
      <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-md">
        {parts.map((p) => (
          <div
            key={p.kind}
            title={`${t(`kind.${p.kind}`)} ${formatMs(p.ms)}`}
            style={{
              width: `${(p.ms / total) * 100}%`,
              background: CHART_COLORS[p.kind],
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
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
  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: INK_MUTED, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            tickFormatter={(v: number) => formatMs(v)}
            tick={{ fill: INK_MUTED, fontSize: 10 }}
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
      <div className="mt-2 flex gap-4 text-xs text-muted">
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
    </div>
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
          tick={{ fill: INK_MUTED, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tick={{ fill: INK_MUTED, fontSize: 10 }}
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
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="name"
          tick={{ fill: INK_MUTED, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis hide />
        <Tooltip content={<DarkTooltip />} cursor={{ fill: "#ffffff0d" }} />
        <Bar
          dataKey="ms"
          fill={CHART_COLORS.run}
          radius={[4, 4, 0, 0]}
          maxBarSize={18}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
