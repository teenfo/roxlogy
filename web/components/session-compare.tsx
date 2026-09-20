"use client";

import { useMemo, useState } from "react";
import { formatDateShort, formatMs } from "@/lib/format";
import { RunLapLine } from "@/components/charts";
import { useI18n } from "@/components/i18n-provider";
import { Choice, DataTable, Empty, Hint, Panel } from "@/components/rox/ui";

export type CompareSession = {
  id: string;
  startedAt: string;
  total: number | null;
  /** stationKey → split ms */
  stations: Record<string, number>;
};

/**
 * 기록 비교 — 시안 Compare 의 Panel "기록 비교": 툴바(지표 선택) · 추이 차트 ·
 * DataTable[날짜 · 기록 · 이전 대비]. 세션 고르기(.rx-check 목록)는 시안에 없는
 * 우리 기능이라 같은 Panel 안에 둔다(§4-1).
 */
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

  const metricLabel = (m: string) =>
    m === "total"
      ? t("compare.total")
      : t(`station.${m}` as Parameters<typeof t>[0]);

  const picked = useMemo(
    () =>
      sessions
        .filter((s) => selected.has(s.id))
        .slice()
        .sort(
          (a, b) =>
            new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
        )
        .map((s) => ({
          id: s.id,
          name: formatDateShort(s.startedAt, tag),
          ms: metric === "total" ? (s.total ?? 0) : (s.stations[metric] ?? 0),
        }))
        .filter((d) => d.ms > 0),
    [sessions, selected, metric, tag],
  );

  const diff = (ms: number, prev: number | null) => {
    if (prev == null) return "—";
    const d = Math.round((ms - prev) / 1000);
    const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
    const a = Math.abs(d);
    return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  };

  return (
    <Panel title={t("compare.title")}>
      <div className="rx-toolbar">
        <Choice
          value={metric}
          onChange={setMetric}
          label={t("compare.metric")}
          options={[["total", t("compare.total")], ...stationKeys.map((k) => [k, metricLabel(k)] as [string, string])]}
        />
      </div>
      {picked.length >= 2 ? (
        <>
          <div style={{ padding: "0 24px" }}>
            <RunLapLine data={picked.map(({ name, ms }) => ({ name, ms }))} />
          </div>
          <DataTable
            headers={[t("compare.pick"), metricLabel(metric), t("chart.vsPrev")]}
            rows={picked.map((d, i) => [
              d.name,
              <strong className="rx-number" key="ms">
                {formatMs(d.ms)}
              </strong>,
              diff(d.ms, i > 0 ? picked[i - 1].ms : null),
            ])}
          />
          <Hint>{t("compare.note", { metric: metricLabel(metric) })}</Hint>
        </>
      ) : (
        <Empty title={t("compare.needMore")} description={t("compare.desc")} />
      )}
      {/* 세션 고르기 — 시안에 없는 우리 기능 */}
      <div style={{ padding: "0 24px 24px" }}>
        <p className="rx-section-label">{t("compare.pick")}</p>
        {sessions.map((s) => (
          <label className="rx-check" key={s.id}>
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
            />
            {formatDateShort(s.startedAt, tag)}
            <span className="rx-muted"> · {formatMs(s.total)}</span>
          </label>
        ))}
      </div>
    </Panel>
  );
}
