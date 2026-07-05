import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { DeleteButton } from "@/components/delete-button";

type RaceSplits = {
  stations?: Record<string, number>;
  run_total_ms?: number;
};

function Delta({ raceMs, trainMs }: { raceMs?: number; trainMs?: number }) {
  if (raceMs == null || trainMs == null)
    return <span className="text-muted">—</span>;
  const diff = raceMs - trainMs; // 음수 = 레이스가 빠름
  const cls = diff <= 0 ? "text-track" : "text-red-400";
  return (
    <span className={`font-mono ${cls}`}>
      {diff <= 0 ? "-" : "+"}
      {formatMs(Math.abs(diff))}
    </span>
  );
}

export default async function RaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag } = await getT();

  const { data: race } = await supabase
    .from("race_results")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!race) notFound();

  // 비교 대상: 스테이션 세그먼트가 있는 가장 최근 세션 (레이스 시뮬)
  const { data: sims } = await supabase
    .from("sessions")
    .select(
      "id, started_at, total_time_ms, session_segments ( kind, exercise_id, split_time_ms )",
    )
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(10);

  const sim = (sims ?? []).find((s) =>
    (s.session_segments ?? []).some(
      (seg: { kind: string }) => seg.kind === "station",
    ),
  );

  const splits = (race.splits ?? {}) as RaceSplits;
  const simByExercise = new Map<string, number>();
  let simRunTotal = 0;
  if (sim) {
    for (const seg of sim.session_segments as {
      kind: string;
      exercise_id: string | null;
      split_time_ms: number | null;
    }[]) {
      if (seg.kind === "station" && seg.exercise_id && seg.split_time_ms != null)
        simByExercise.set(seg.exercise_id, seg.split_time_ms);
      if (seg.kind === "run" && seg.split_time_ms != null)
        simRunTotal += seg.split_time_ms;
    }
  }

  const hasStationSplits = Object.keys(splits.stations ?? {}).length > 0;

  return (
    <main>
      <div className="flex items-center justify-between">
        <Link href="/races" className="text-sm text-muted hover:text-foreground">
          {t("races.back")}
        </Link>
        <DeleteButton kind="race" id={race.id} redirectTo="/races" />
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{race.event}</h1>
        <span className="font-mono text-3xl font-bold text-accent">
          {formatMs(race.total_time_ms)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {race.event_date ?? t("races.noDate")} ·{" "}
        {race.division
          ? t(`division.${race.division}` as Parameters<typeof t>[0])
          : "—"}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          {t("races.compareTitle")}
          {sim && (
            <span className="ml-2 text-sm font-normal text-muted">
              {t("races.compareVs", { date: formatDate(sim.started_at, tag) })}
            </span>
          )}
        </h2>

        {!sim ? (
          <p className="mt-4 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            {t("races.noSim")}{" "}
            <Link href="/sessions/new" className="text-accent hover:underline">
              {t("races.noSimLink")}
            </Link>
          </p>
        ) : !hasStationSplits ? (
          <p className="mt-4 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            {t("races.totalOnlyCompare", {
              race: formatMs(race.total_time_ms),
              sim: formatMs(sim.total_time_ms),
            })}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-normal">{t("races.colSegment")}</th>
                  <th className="py-2 pr-4 text-right font-normal">
                    {t("races.colRace")}
                  </th>
                  <th className="py-2 pr-4 text-right font-normal">
                    {t("races.colSim")}
                  </th>
                  <th className="py-2 text-right font-normal">
                    {t("races.colDiff")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {splits.run_total_ms != null && (
                  <tr className="border-b border-surface/60">
                    <td className="py-2.5 pr-4">{t("races.runTotal")}</td>
                    <td className="py-2.5 pr-4 text-right font-mono">
                      {formatMs(splits.run_total_ms)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono">
                      {simRunTotal ? formatMs(simRunTotal) : "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      <Delta
                        raceMs={splits.run_total_ms}
                        trainMs={simRunTotal || undefined}
                      />
                    </td>
                  </tr>
                )}
                {STATIONS.map((s) => {
                  const raceMs = splits.stations?.[s.key];
                  const trainMs = simByExercise.get(s.exerciseId);
                  if (raceMs == null && trainMs == null) return null;
                  return (
                    <tr key={s.key} className="border-b border-surface/60">
                      <td className="py-2.5 pr-4">
                        {t(`station.${s.key}` as Parameters<typeof t>[0])}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono">
                        {raceMs != null ? formatMs(raceMs) : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono">
                        {trainMs != null ? formatMs(trainMs) : "—"}
                      </td>
                      <td className="py-2.5 text-right">
                        <Delta raceMs={raceMs} trainMs={trainMs} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">{t("races.diffNote")}</p>
          </div>
        )}
      </section>
    </main>
  );
}
