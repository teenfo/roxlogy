import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
          ← 레이스
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
        {race.event_date ?? "날짜 미입력"} · {race.division ?? "—"}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          훈련 대비 비교
          {sim && (
            <span className="ml-2 text-sm font-normal text-muted">
              vs {formatDate(sim.started_at)} 레이스 시뮬
            </span>
          )}
        </h2>

        {!sim ? (
          <p className="mt-4 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            비교할 레이스 시뮬 세션이 없습니다.{" "}
            <Link href="/sessions/new" className="text-accent hover:underline">
              세션을 기록
            </Link>
            하면 레이스와 나란히 비교해 드립니다.
          </p>
        ) : !hasStationSplits ? (
          <p className="mt-4 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            이 레이스에 스테이션 스플릿이 입력되지 않아 총 기록만 비교합니다:
            레이스 {formatMs(race.total_time_ms)} vs 시뮬{" "}
            {formatMs(sim.total_time_ms)}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-normal">구간</th>
                  <th className="py-2 pr-4 text-right font-normal">레이스</th>
                  <th className="py-2 pr-4 text-right font-normal">훈련 시뮬</th>
                  <th className="py-2 text-right font-normal">차이</th>
                </tr>
              </thead>
              <tbody>
                {splits.run_total_ms != null && (
                  <tr className="border-b border-surface/60">
                    <td className="py-2.5 pr-4">런 합계 (8km)</td>
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
                      <td className="py-2.5 pr-4">{s.nameKo}</td>
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
            <p className="mt-2 text-xs text-muted">
              차이는 레이스 − 훈련. 파란색이면 레이스에서 더 빨랐다는 뜻입니다.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
