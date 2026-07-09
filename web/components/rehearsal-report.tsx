"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatMs } from "@/lib/format";
import { useI18n } from "@/components/i18n-provider";

export type RehearsalGoal = {
  id: string;
  target: number;
  division: string | null;
  eventName: string | null;
  eventDate: string | null;
  stations: { key: string; targetMs: number }[];
};

export type RehearsalSession = {
  id: string;
  label: string;
  total: number | null;
  stations: Record<string, number>;
};

export function RehearsalReport({
  goals,
  sessions,
}: {
  goals: RehearsalGoal[];
  sessions: RehearsalSession[];
}) {
  const { t } = useI18n();
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");

  const goal = goals.find((g) => g.id === goalId) ?? goals[0];
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];

  const goalLabel = (g: RehearsalGoal) =>
    [
      formatMs(g.target),
      g.eventName ?? null,
      g.division
        ? t(`division.${g.division}` as Parameters<typeof t>[0])
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const rows = useMemo(() => {
    if (!goal || !session) return [];
    return goal.stations
      .map((gs) => ({
        key: gs.key,
        target: gs.targetMs,
        actual: session.stations[gs.key] ?? null,
      }))
      .filter((r) => r.actual != null);
  }, [goal, session]);

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("dash.rehearsalTitle")}</h2>
        <Link href="/goals" className="text-sm text-accent hover:underline">
          {t("goals.title")}
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("dash.rehGoal")}
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          >
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {goalLabel(g)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("dash.rehSession")}
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {formatMs(s.total)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-2 text-sm text-muted">
        {t("dash.rehearsalDesc", {
          target: formatMs(goal?.target),
          sim: session?.total ? formatMs(session.total) : "—",
        })}
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
          {t("dash.rehNoMatch")}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md bg-surface p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-background text-left text-xs text-muted">
                <th className="py-2 pr-4 font-normal">{t("dash.rehStation")}</th>
                <th className="py-2 pr-4 text-right font-normal">
                  {t("dash.rehTarget")}
                </th>
                <th className="py-2 pr-4 text-right font-normal">
                  {t("dash.rehActual")}
                </th>
                <th className="py-2 text-right font-normal">{t("dash.rehGap")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const gap = r.actual! - r.target;
                return (
                  <tr key={r.key} className="border-b border-background/60">
                    <td className="py-2 pr-4">
                      {t(`station.${r.key}` as Parameters<typeof t>[0])}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-muted">
                      {formatMs(r.target)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {formatMs(r.actual!)}
                    </td>
                    <td
                      className={`py-2 text-right font-mono ${gap <= 0 ? "text-track" : "text-red-400"}`}
                    >
                      {gap <= 0 ? "-" : "+"}
                      {formatMs(Math.abs(gap))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">{t("dash.rehNote")}</p>
        </div>
      )}
    </section>
  );
}
