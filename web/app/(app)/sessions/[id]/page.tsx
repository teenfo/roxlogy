import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  formatDate,
  formatMs,
  KIND_LABEL,
  SOURCE_DEVICE_LABEL,
} from "@/lib/format";

const KIND_BADGE: Record<string, string> = {
  run: "border-track/60 text-track",
  station: "border-accent/60 text-accent",
  roxzone: "border-muted/60 text-muted",
};

type Segment = {
  id: string;
  seq: number;
  kind: string;
  machine_type: string | null;
  split_time_ms: number | null;
  exercises: { name_ko: string; name_en: string } | null;
  segment_metrics: {
    avg_power: number | null;
    avg_spm: number | null;
    avg_pace_500: number | null;
  } | null;
};

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select(
      `id, started_at, ended_at, total_time_ms, source_device, analysis_status,
       session_metrics ( run_lap_deviation_ms, roxzone_total_ms, pacing_grade ),
       session_segments (
         id, seq, kind, machine_type, split_time_ms,
         exercises ( name_ko, name_en ),
         segment_metrics ( avg_power, avg_spm, avg_pace_500 )
       )`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!session) notFound();

  const segments = ((session.session_segments ?? []) as unknown as Segment[])
    .slice()
    .sort((a, b) => a.seq - b.seq);
  const metrics = Array.isArray(session.session_metrics)
    ? session.session_metrics[0]
    : session.session_metrics;

  return (
    <main>
      <Link href="/sessions" className="text-sm text-muted hover:text-foreground">
        ← 세션 히스토리
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{formatDate(session.started_at)}</h1>
        <span className="font-mono text-3xl font-bold text-accent">
          {formatMs(session.total_time_ms)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {SOURCE_DEVICE_LABEL[session.source_device] ?? session.source_device} 기록
      </p>

      <section className="mt-8 grid grid-cols-3 gap-3">
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">런 랩 편차</p>
          <p className="mt-1 font-mono text-lg font-semibold">
            {metrics?.run_lap_deviation_ms != null
              ? `±${Math.round(metrics.run_lap_deviation_ms / 1000)}초`
              : "분석 대기중"}
          </p>
        </div>
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">록스존 합계</p>
          <p className="mt-1 font-mono text-lg font-semibold">
            {metrics?.roxzone_total_ms != null
              ? formatMs(metrics.roxzone_total_ms)
              : "분석 대기중"}
          </p>
        </div>
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">페이싱</p>
          <p className="mt-1 text-lg font-semibold">
            {metrics?.pacing_grade ?? "분석 대기중"}
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">세그먼트</h2>
        {!segments.length ? (
          <p className="mt-4 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            세그먼트 기록이 없습니다.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-1.5">
            {segments.map((seg) => (
              <li
                key={seg.id}
                className="flex items-center gap-3 rounded-md bg-surface px-4 py-2.5"
              >
                <span className="w-6 text-right font-mono text-xs text-muted">
                  {seg.seq}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-xs ${KIND_BADGE[seg.kind] ?? ""}`}
                >
                  {KIND_LABEL[seg.kind] ?? seg.kind}
                </span>
                <span className="flex-1 text-sm">
                  {seg.exercises?.name_ko ??
                    (seg.kind === "run"
                      ? "1km 러닝"
                      : seg.kind === "roxzone"
                        ? "트랜지션"
                        : "—")}
                  {seg.machine_type && (
                    <span className="ml-2 text-xs text-muted">
                      {seg.machine_type === "ski" ? "스키에르그" : "로잉"}
                    </span>
                  )}
                </span>
                {seg.segment_metrics?.avg_power != null && (
                  <span className="font-mono text-xs text-muted">
                    {Math.round(Number(seg.segment_metrics.avg_power))}W
                  </span>
                )}
                <span className="w-16 text-right font-mono text-sm font-semibold">
                  {formatMs(seg.split_time_ms)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
