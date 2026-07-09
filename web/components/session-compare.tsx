"use client";

import { useMemo, useState } from "react";
import { formatDateShort, formatMs } from "@/lib/format";
import { RunLapLine } from "@/components/charts";
import { useI18n } from "@/components/i18n-provider";

export type CompareSession = {
  id: string;
  startedAt: string;
  total: number | null;
  /** stationKey → split ms */
  stations: Record<string, number>;
};

export function SessionCompare({
  sessions,
  stationKeys,
}: {
  sessions: CompareSession[];
  stationKeys: string[];
}) {
  const { t, tag } = useI18n();
  // 최신순으로 받은 세션 — 기본으로 최근 6개 선택
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sessions.slice(0, 6).map((s) => s.id)),
  );
  const [metric, setMetric] = useState<string>("total");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const chartData = useMemo(() => {
    return sessions
      .filter((s) => selected.has(s.id))
      .slice()
      .sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      )
      .map((s) => ({
        name: formatDateShort(s.startedAt, tag),
        ms: metric === "total" ? (s.total ?? 0) : (s.stations[metric] ?? 0),
      }))
      .filter((d) => d.ms > 0);
  }, [sessions, selected, metric, tag]);

  const metricLabel = (m: string) =>
    m === "total"
      ? t("compare.total")
      : t(`station.${m}` as Parameters<typeof t>[0]);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* 세션 선택 */}
      <div>
        <p className="text-sm font-semibold">{t("compare.pick")}</p>
        <ul className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-accent"
                />
                <span className="flex-1">{formatDateShort(s.startedAt, tag)}</span>
                <span className="font-mono text-xs text-muted">
                  {formatMs(s.total)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {/* 차트 */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-muted">{t("compare.metric")}</label>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="total">{t("compare.total")}</option>
            {stationKeys.map((k) => (
              <option key={k} value={k}>
                {metricLabel(k)}
              </option>
            ))}
          </select>
        </div>

        {chartData.length >= 2 ? (
          <div className="mt-4 rounded-md bg-surface p-4">
            <RunLapLine data={chartData} />
            <p className="mt-2 text-xs text-muted">
              {t("compare.note", { metric: metricLabel(metric) })}
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
            {t("compare.needMore")}
          </p>
        )}
      </div>
    </div>
  );
}
