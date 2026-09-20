import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Flag, Link2, TriangleAlert } from "lucide-react";
import { AiInsight } from "@/components/ai-insight";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDate, formatDateShortYear, formatMs } from "@/lib/format";
import { getRaceBenchmarks } from "@/lib/cache";
import {
  hyroxAgeGroup,
  percentileOfBest,
  pickBenchmark,
  type Benchmark,
} from "@/lib/percentile";
import { DistributionCurve } from "@/components/distribution-curve";
import {
  breakdown,
  longestRoxzone,
  pacingGrade,
  runLapDeviationMs,
} from "@/lib/analysis";
import { formatDistance, gradeDictKey, type Degradation } from "@/lib/run";
import {
  BreakdownStackBar,
  DriveChart,
  ErgCurve,
  SegmentSplitBars,
  StrokeForceChart,
} from "@/components/charts";
import { CHART_COLORS } from "@/lib/hyrox";
import { DeleteButton } from "@/components/delete-button";
import { ShareToggle } from "@/components/share-toggle";
import { FollowButton } from "@/components/follow-button";
import {
  Back,
  Chip,
  DataTable,
  Go,
  Hint,
  PageHead,
  Panel,
  Stats,
} from "@/components/rox/ui";

type Segment = {
  id: string;
  seq: number;
  kind: "run" | "station" | "roxzone";
  machine_type: string | null;
  split_time_ms: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  exercises: { name_ko: string; name_en: string } | null;
  segment_metrics: {
    avg_power: number | null;
    avg_spm: number | null;
    avg_pace_500: number | null;
    pace_curve: [number, number][] | null;
    power_curve: [number, number][] | null;
  } | null;
  // PostgREST 1:1 embed 는 객체로 오고, 배열 판정 코드가 있던 곳은 항상 "no raw" 였다
  erg_samples: { sample_count: number }[] | { sample_count: number } | null;
};

function rawOf(seg: Segment): { sample_count: number } | null {
  const e = seg.erg_samples;
  if (!e) return null;
  return Array.isArray(e) ? (e[0] ?? null) : e;
}

type ErgRawRow = {
  segment_id: string;
  samples:
    | { t: number; dist: number; pace: number | null; spm: number | null; watts: number | null }[]
    | null;
  strokes:
    | {
        n: number;
        drive_ms: number | null;
        recover_ms: number | null;
        drive_len: number | null;
        stroke_dist: number | null;
        peak_force: number | null;
        avg_force: number | null;
        work_j: number | null;
      }[]
    | null;
};

function fmtPace(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag, tz } = await getT();
  const { data } = await supabase
    .from("sessions")
    .select("started_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return {
    title: data
      ? t("meta.sessionDetail", { date: formatDate(data.started_at, tag, tz) })
      : "Roxlogy",
  };
}

/**
 * 세션 상세 — 시안 records.tsx 의 RecordDetail 그대로 (PORT_PLAN §3-b):
 * Back · PageHead(기록 카드·편집) · .rx-detail-hero · Stats · two-col[런 페이스 흐름 |
 * 구간별 기록] · Panel "기록에서 읽을 수 있는 것" · Panel "기록 상세".
 * 시안에 없는 우리 분석(구성비·분포 곡선·스플릿 바·저하율·에르그 곡선·스트로크·AI)은
 * 그 아래 Panel 로만 감싼다(§4-1).
 */
export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag, locale, tz } = await getT();
  const user = await getCachedUser();

  const { data: session } = await supabase
    .from("sessions")
    .select(
      `id, user_id, shared, started_at, ended_at, total_time_ms, source_device, analysis_status, notes, rpe, division,
       profiles ( display_name ),
       race_results ( event, event_date, season, division ),
       workout_templates ( id, title, program_days ( day_index, programs ( id, title ) ) ),
       session_metrics ( run_lap_deviation_ms, roxzone_total_ms, pacing_grade ),
       session_segments (
         id, seq, kind, machine_type, split_time_ms, avg_hr, max_hr,
         exercises ( name_ko, name_en ),
         segment_metrics ( avg_power, avg_spm, avg_pace_500, pace_curve, power_curve ),
         erg_samples ( sample_count )
       )`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!session) notFound();

  const isOwner = session.user_id === user!.id;

  // 연결된 프로그램 워크아웃 (RLS: 비공개 프로그램은 타인에게 embed되지 않음)
  type LinkedWorkout = {
    id: string;
    title: string;
    program_days: {
      day_index: number;
      programs: { id: string; title: string } | null;
    } | null;
  } | null;
  const linked = (session.workout_templates ??
    null) as unknown as LinkedWorkout;

  const exName = (ex: Segment["exercises"]) =>
    ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : null;

  const segments = ((session.session_segments ?? []) as unknown as Segment[])
    .slice()
    .sort((a, b) => a.seq - b.seq);
  const workerMetrics = Array.isArray(session.session_metrics)
    ? session.session_metrics[0]
    : session.session_metrics;

  const share = breakdown(segments);
  const deviation =
    workerMetrics?.run_lap_deviation_ms ?? runLapDeviationMs(segments);
  const grade =
    (workerMetrics?.pacing_grade as
      | "very_consistent"
      | "consistent"
      | "variable"
      | "erratic"
      | null) ?? (deviation != null ? pacingGrade(deviation) : null);
  const roxzoneMs = workerMetrics?.roxzone_total_ms ?? share.roxzoneMs;
  const slowestZone = longestRoxzone(segments);

  const runLaps = segments.filter(
    (s) => s.kind === "run" && s.split_time_ms != null,
  );
  const stationSegs = segments.filter((s) => s.kind === "station");
  const roxSegs = segments.filter((s) => s.kind === "roxzone");
  const chartData = segments
    .filter((s) => s.split_time_ms != null)
    .map((s) => ({
      name:
        exName(s.exercises) ?? `${t(`kind.${s.kind}`)} ${s.seq}`,
      ms: s.split_time_ms!,
      kind: s.kind,
    }));

  // 에르그 단독 세션(런·록스존 없이 머신 스테이션만) → 전용 구성.
  const isErg =
    segments.length > 0 &&
    segments.every((s) => s.kind === "station") &&
    segments.some((s) => s.machine_type);

  // erg raw · 개인 최고 · 러닝 저하율은 서로 의존하지 않는다 — 한 번에 기다린다.
  const needsPb = isOwner;
  const needsDeg = isOwner && !isErg && runLaps.length >= 2;
  const [rawsRes, pbRes, degRes] = await Promise.all([
    isErg
      ? supabase
          .from("erg_samples")
          .select("segment_id, samples, strokes")
          .in(
            "segment_id",
            segments.map((s) => s.id),
          )
      : Promise.resolve({ data: null }),
    // 개인 최고(대회) — 히어로의 "PB 대비". 본인 세션에서만 의미가 있다.
    needsPb
      ? supabase
          .from("sessions")
          .select("total_time_ms, race_results!inner ( event )")
          .eq("user_id", session.user_id)
          .is("deleted_at", null)
          .not("total_time_ms", "is", null)
          .order("total_time_ms", { ascending: true })
          .limit(1)
      : Promise.resolve({ data: null }),
    // 러닝 저하율 — 본인 세션에서만 계산한다(기준선은 내 러닝 기록).
    needsDeg
      ? supabase.rpc("session_run_degradation", { p_session: id })
      : Promise.resolve({ data: null }),
  ]);
  const ergRaws = (rawsRes.data ?? []) as ErgRawRow[];
  const ergSamplesAll = ergRaws.flatMap((r) => r.samples ?? []);
  const ergStrokesAll = ergRaws.flatMap((r) => r.strokes ?? []);

  const raceRaw = (session as { race_results?: unknown }).race_results;
  const race = (Array.isArray(raceRaw) ? raceRaw[0] : raceRaw) as
    | { event: string | null; event_date: string | null; season: string | null; division: string | null }
    | null
    | undefined;

  const pbMs: number | null =
    ((pbRes.data ?? []) as { total_time_ms: number }[])[0]?.total_time_ms ?? null;
  const pbGap =
    pbMs != null && session.total_time_ms != null
      ? session.total_time_ms - pbMs
      : null;
  const gapLabel = (ms: number) => {
    const d = Math.round(ms / 1000);
    const a = Math.abs(d);
    return `${d >= 0 ? "+" : "−"}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  };

  const degradation = (degRes.data ?? null) as Degradation | null;

  // 필드 분포 곡선 — 풀 시뮬(런8+스테이션8, 30분↑) + 본인 세션일 때만.
  let dist: {
    percentiles: Record<string, number>;
    pct: number;
    byAge: boolean;
    ageGroup: string | null;
  } | null = null;
  const isFullSim =
    !isErg &&
    stationSegs.length >= 8 &&
    segments.filter((s) => s.kind === "run").length >= 8 &&
    (session.total_time_ms ?? 0) >= 1_800_000;
  if (isFullSim && user && user.id === session.user_id) {
    const [{ data: myProfile }, benchmarks] = await Promise.all([
      supabase
        .from("profiles")
        .select("gender, birth_year")
        .eq("id", user.id)
        .maybeSingle(),
      getRaceBenchmarks(),
    ]);
    const ageGroup = hyroxAgeGroup(myProfile?.birth_year ?? null);
    const division = (session.division as string | null) ?? "open";
    const best = percentileOfBest(
      session.total_time_ms,
      division,
      myProfile?.gender ?? null,
      ageGroup,
      benchmarks as Benchmark[],
    );
    if (best) {
      const scope = best.byAge ? `age:${ageGroup}` : "overall";
      const bm = pickBenchmark(
        benchmarks as Benchmark[],
        division,
        myProfile?.gender ?? null,
        scope,
      );
      if (bm) {
        dist = { percentiles: bm.percentiles, pct: best.pct, byAge: best.byAge, ageGroup };
      }
    }
  }
  const ergDist = ergSamplesAll.length
    ? Math.max(...ergSamplesAll.map((s) => s.dist))
    : null;
  const spmCurve = ergSamplesAll
    .filter((s) => s.spm != null)
    .map((s) => ({ t: s.t, v: s.spm! }));
  const avgOf = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const ergAvgDriveLen = avgOf(ergStrokesAll.map((s) => s.drive_len));
  const ergAvgStrokeDist = avgOf(ergStrokesAll.map((s) => s.stroke_dist));
  const ergAvgWork = avgOf(ergStrokesAll.map((s) => s.work_j));
  const ergDriveMs = avgOf(ergStrokesAll.map((s) => s.drive_ms));
  const ergRecoverMs = avgOf(ergStrokesAll.map((s) => s.recover_ms));
  const ergMetrics = segments.find((s) => s.segment_metrics)?.segment_metrics;

  // S6 파워/페이스 곡선 — 워커가 채운 segment_metrics 곡선이 있는 세그먼트
  const ergSegments = segments
    .filter(
      (s) =>
        (s.segment_metrics?.pace_curve?.length ?? 0) > 1 ||
        (s.segment_metrics?.power_curve?.length ?? 0) > 1,
    )
    .map((s) => ({
      key: s.id,
      name: exName(s.exercises) ?? `${t(`kind.${s.kind}`)} ${s.seq}`,
      pace: (s.segment_metrics?.pace_curve ?? []).map(([tt, v]) => ({ t: tt, v })),
      power: (s.segment_metrics?.power_curve ?? []).map(([tt, v]) => ({ t: tt, v })),
    }));

  // 종류별 평균 — 세그먼트 표의 "평균 대비"
  const kindAvg = new Map<string, number>();
  for (const k of ["run", "station", "roxzone"]) {
    const xs = segments
      .filter((x) => x.kind === k && x.split_time_ms != null)
      .map((x) => x.split_time_ms!);
    if (xs.length) kindAvg.set(k, xs.reduce((a, v) => a + v, 0) / xs.length);
  }
  const vsAvg = (seg: Segment) => {
    const avg = kindAvg.get(seg.kind);
    if (avg == null || seg.split_time_ms == null) return "";
    const d = Math.round((seg.split_time_ms - avg) / 1000);
    if (Math.abs(d) < 1) return "";
    const a = Math.abs(d);
    return `${d > 0 ? "+" : "−"}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  };

  // 랩 추이 요약 — 평균과 첫 랩 대비 마지막 랩 변화
  const lapMs = runLaps.map((x) => x.split_time_ms!);
  const lapAvg = lapMs.length
    ? Math.round(lapMs.reduce((a, v) => a + v, 0) / lapMs.length)
    : null;
  const lapDrift = lapMs.length >= 2 ? lapMs[lapMs.length - 1] - lapMs[0] : null;

  const divisionKey = race?.division ?? session.division ?? null;
  const divisionLabel = divisionKey
    ? t(`division.${divisionKey}` as Parameters<typeof t>[0])
    : null;
  const total = session.total_time_ms ?? 0;
  const pctOf = (ms: number) => (total > 0 ? ((ms / total) * 100).toFixed(1) : "0");
  const kindLabel = race
    ? t("sessions.race")
    : isErg
      ? t("sessions.ergDedicated")
      : t("sessions.typeSim");
  const title = race?.event ?? formatDate(session.started_at, tag, tz);
  const rounds = Math.max(runLaps.length, stationSegs.length, roxSegs.length);

  return (
    <>
      <Back
        href={isOwner ? "/sessions" : "/feed"}
        label={isOwner ? t("sessions.title") : t("nav.feed")}
      />
      <PageHead
        title={title}
        description={[
          formatDate(session.started_at, tag, tz),
          divisionLabel,
          t(`source.${session.source_device}` as Parameters<typeof t>[0]),
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="rx-actions">
            {isOwner ? (
              <>
                <ShareToggle id={session.id} shared={session.shared} />
                <Go href={`/sessions/${session.id}/share`}>{t("detail.card")}</Go>
                <Go href={`/sessions/${session.id}/edit`}>{t("sessions.edit")}</Go>
                <DeleteButton kind="session" id={session.id} redirectTo="/sessions" />
              </>
            ) : (
              <FollowButton authorId={session.user_id} />
            )}
          </div>
        }
      />

      <div className="rx-detail-hero">
        <div>
          <Chip tone="yellow">{kindLabel}</Chip>{" "}
          {divisionLabel && <Chip>{divisionLabel}</Chip>}
          <p>FINISH TIME</p>
          <strong>{formatMs(session.total_time_ms)}</strong>
        </div>
        <div>
          <span>{t("detail.status")}</span>
          <h3>
            {pbGap != null
              ? pbGap <= 0
                ? t("sessions.pb")
                : `PB ${gapLabel(pbGap)}`
              : session.analysis_status !== "done"
                ? t("common.analysisPending")
                : t("detail.finished")}
          </h3>
          <p>
            {dist
              ? t("sessions.distTop", { pct: dist.pct })
              : t("sessions.recordedVia", {
                  device: t(`source.${session.source_device}` as Parameters<typeof t>[0]),
                })}
          </p>
        </div>
      </div>

      {(linked || (isOwner && (session.rpe != null || session.notes))) && (
        <div className="rx-notice">
          <Link2 size={21} />
          <div>
            {linked && (
              <b>
                {t("sessions.partOfProgram")}{" "}
                {linked.program_days?.programs ? (
                  <Link href={`/programs/${linked.program_days.programs.id}`}>
                    {linked.program_days.programs.title}
                    {linked.program_days.day_index != null
                      ? ` · ${t("programs.dayN", { n: linked.program_days.day_index })}`
                      : ""}
                    {` · ${linked.title}`}
                  </Link>
                ) : (
                  linked.title
                )}
              </b>
            )}
            {isOwner && session.rpe != null && (
              <p>
                {t("sessions.rpe")} {t("sessions.rpeValue", { n: session.rpe })}
              </p>
            )}
            {isOwner && session.notes && (
              <p style={{ whiteSpace: "pre-wrap" }}>{session.notes}</p>
            )}
          </div>
        </div>
      )}

      {session.analysis_status !== "done" && !isErg && (
        <div className="rx-notice">
          <TriangleAlert size={21} />
          <div>
            <b>{t("common.analysisPending")}</b>
          </div>
        </div>
      )}

      {isErg ? (
        <Stats
          items={[
            [t("sessions.ergDistance"), ergDist != null ? `${Math.round(ergDist)} m` : "—", ""],
            [
              t("sessions.ergAvgPower"),
              ergMetrics?.avg_power != null ? `${Math.round(Number(ergMetrics.avg_power))} W` : "—",
              "",
            ],
            [
              t("sessions.ergAvgPace"),
              ergMetrics?.avg_pace_500 != null
                ? `${fmtPace(Number(ergMetrics.avg_pace_500))} /500m`
                : "—",
              "",
            ],
            [
              t("sessions.ergAvgSpm"),
              ergMetrics?.avg_spm != null ? String(Math.round(Number(ergMetrics.avg_spm))) : "—",
              ergStrokesAll.length ? `${t("sessions.ergStrokes")} ${ergStrokesAll.length}` : "",
            ],
          ]}
        />
      ) : (
        <Stats
          items={[
            [t("kind.run"), formatMs(share.runMs), t("detail.ofTotal", { pct: pctOf(share.runMs) })],
            [
              t("detail.station"),
              formatMs(share.stationMs),
              t("detail.ofTotal", { pct: pctOf(share.stationMs) }),
            ],
            [t("kind.roxzone"), roxzoneMs ? formatMs(roxzoneMs) : "—", t("detail.otherNote")],
            [
              t("sessions.pacing"),
              grade ? t(`pacing.${grade}`) : "—",
              deviation != null
                ? `${t("sessions.runLapDeviation")} ${t("sessions.deviationSec", { n: Math.round(deviation / 1000) })}`
                : "",
            ],
          ]}
        />
      )}

      {!isErg && (
        <div className="rx-two-col">
          <Panel
            title={t("detail.runPace")}
            action={<Chip>{runLaps.length} × 1 km</Chip>}
          >
            {runLaps.length ? (
              <>
                <div className="rx-lap-chart">
                  {runLaps.map((seg, i) => (
                    <div key={seg.id}>
                      <span>{formatMs(seg.split_time_ms)}</span>
                      <div style={{ height: Math.round(seg.split_time_ms! / 4000) + "px" }} />
                      <small>RUN {i + 1}</small>
                    </div>
                  ))}
                </div>
                <Hint>
                  {lapAvg != null && `${t("sessions.lapAvg")} ${formatMs(lapAvg)}`}
                  {lapDrift != null &&
                    ` · ${lapDrift >= 0 ? "+" : "−"}${formatMs(Math.abs(lapDrift))}`}
                </Hint>
              </>
            ) : (
              <Hint>{t("detail.noSplits")}</Hint>
            )}
          </Panel>
          <Panel title={t("detail.splits")}>
            {rounds > 0 ? (
              <DataTable
                headers={[t("detail.round"), t("kind.run"), t("kind.roxzone"), t("detail.station")]}
                rows={Array.from({ length: rounds }, (_, i) => [
                  <span key="s">
                    <small className="rx-muted">{String(i + 1).padStart(2, "0")} </small>
                    {stationSegs[i] ? (exName(stationSegs[i].exercises) ?? "") : ""}
                  </span>,
                  runLaps[i] ? formatMs(runLaps[i].split_time_ms) : "—",
                  roxSegs[i]?.split_time_ms != null ? formatMs(roxSegs[i].split_time_ms) : "—",
                  stationSegs[i]?.split_time_ms != null
                    ? formatMs(stationSegs[i].split_time_ms)
                    : "—",
                ])}
              />
            ) : (
              <Hint>{t("sessions.noSegments")}</Hint>
            )}
          </Panel>
        </div>
      )}

      <Panel title={t("detail.insights")}>
        {!isErg && share.totalMs > 0 && (
          <div className="rx-insight">
            <Flag />
            <div>
              <h3>{t("detail.runShare", { pct: pctOf(share.runMs) })}</h3>
              <p>
                {t("detail.runShareNote", {
                  run: formatMs(share.runMs),
                  total: formatMs(total),
                })}
              </p>
            </div>
          </div>
        )}
        {grade && (
          <div className="rx-insight">
            <Activity />
            <div>
              <h3>
                {t("sessions.pacing")}: {t(`pacing.${grade}`)}
              </h3>
              <p>
                {deviation != null &&
                  `${t("sessions.runLapDeviation")} ${t("sessions.deviationSec", { n: Math.round(deviation / 1000) })}`}
                {slowestZone && ` · ${t("sessions.longestTransition")} ${formatMs(slowestZone.ms)}`}
              </p>
            </div>
          </div>
        )}
        {degradation && degradation.degradation_pct != null && (
          <div className="rx-insight">
            <Activity />
            <div>
              <h3>{t("run.degSlower", { pct: degradation.degradation_pct })}</h3>
              <p>
                {t(gradeDictKey(degradation.grade))} · {t("run.degLap")}{" "}
                {formatMs(degradation.sim_lap_avg_ms)} · {t("run.degBaseline")}{" "}
                {formatMs(degradation.baseline!.baseline_1k_ms)} ·{" "}
                <Link href="/runs">
                  {t("run.baselineFrom", {
                    distance: formatDistance(degradation.baseline!.from_distance_m),
                    date: formatDateShortYear(degradation.baseline!.from_ran_on, tag, tz),
                  })}
                </Link>
              </p>
            </div>
          </div>
        )}
        {degradation && degradation.degradation_pct == null && (
          <div className="rx-insight">
            <Activity />
            <div>
              <h3>{t("run.degTitle")}</h3>
              <p>
                {t("run.degNone")} <Link href="/runs/new">{t("run.add")}</Link>
              </p>
            </div>
          </div>
        )}
        {dist && (
          <div className="rx-insight">
            <Flag />
            <div>
              <h3>{t("sessions.distTop", { pct: dist.pct })}</h3>
              <p>
                {dist.byAge && dist.ageGroup
                  ? t("dist.captionAge", {
                      division: t(`division.${(session.division as string | null) ?? "open"}` as Parameters<typeof t>[0]),
                      age: dist.ageGroup,
                    })
                  : t("dist.caption", {
                      division: t(`division.${(session.division as string | null) ?? "open"}` as Parameters<typeof t>[0]),
                    })}
              </p>
            </div>
          </div>
        )}
        {isErg && !ergSegments.length && !dist && !grade && (
          <Hint>{t("sessions.ergDedicated")}</Hint>
        )}
      </Panel>

      {/* ── 시안에 없는 우리 분석 (PORT_PLAN §4-1) ── */}
      {!isErg && share.totalMs > 0 && (
        <Panel title={t("sessions.timeComposition")}>
          <div style={{ padding: "0 24px 24px" }}>
            <BreakdownStackBar
              runMs={share.runMs}
              stationMs={share.stationMs}
              roxzoneMs={share.roxzoneMs}
            />
          </div>
        </Panel>
      )}
      {dist && (
        <Panel>
          <div style={{ padding: "0 24px 24px" }}>
            <DistributionCurve
              percentiles={dist.percentiles}
              myMs={session.total_time_ms!}
              pct={dist.pct}
              caption={t("dist.caption", {
                division: t(`division.${(session.division as string | null) ?? "open"}` as Parameters<typeof t>[0]),
              })}
            />
          </div>
        </Panel>
      )}
      {!isErg && chartData.length > 1 && (
        <Panel title={t("sessions.segmentSplits")}>
          <div style={{ padding: "0 24px 24px" }}>
            <SegmentSplitBars data={chartData} />
          </div>
        </Panel>
      )}
      {ergSegments.length > 0 && (
        <Panel title={t("sessions.ergCurves")}>
          <div style={{ padding: "0 24px 24px" }}>
            <p className="rx-hint" style={{ marginBottom: 12 }}>
              {t("sessions.ergCurvesDesc")}
            </p>
            {ergSegments.map((e) => (
              <div key={e.key} style={{ marginBottom: 16 }}>
                <p className="rx-section-label">{e.name}</p>
                {e.power.length > 1 && (
                  <ErgCurve data={e.power} color={CHART_COLORS.station} unit="W" />
                )}
                {e.pace.length > 1 && (
                  <ErgCurve data={e.pace} color={CHART_COLORS.run} unit="/500m" />
                )}
                {isErg && spmCurve.length > 1 && (
                  <ErgCurve data={spmCurve} color="var(--chart-5)" unit="spm" />
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {isErg && ergStrokesAll.length > 1 && (
        <Panel title={t("sessions.strokeSection")}>
          <DataTable
            headers={[t("sessions.avgDriveLen"), t("sessions.avgStrokeDist"), t("sessions.driveRatio"), t("sessions.ergAvgWork")]}
            rows={[
              [
                ergAvgDriveLen != null ? `${ergAvgDriveLen.toFixed(2)} m` : "—",
                ergAvgStrokeDist != null ? `${ergAvgStrokeDist.toFixed(2)} m` : "—",
                ergDriveMs != null && ergRecoverMs != null && ergDriveMs > 0
                  ? `1 : ${(ergRecoverMs / ergDriveMs).toFixed(2)}`
                  : "—",
                ergAvgWork != null ? `${Math.round(ergAvgWork)} J` : "—",
              ],
            ]}
          />
          <div style={{ padding: "0 24px 24px" }}>
            <p className="rx-section-label">{t("sessions.strokeForce")}</p>
            <StrokeForceChart
              data={ergStrokesAll.map((s) => ({ n: s.n, peak: s.peak_force, avg: s.avg_force }))}
              peakLabel={t("sessions.peakForce")}
              avgLabel={t("sessions.avgForce")}
            />
            <p className="rx-section-label" style={{ marginTop: 16 }}>
              {t("sessions.driveAnalysis")}
            </p>
            <DriveChart
              data={ergStrokesAll.map((s) => ({
                n: s.n,
                drive: s.drive_ms != null ? Math.round(s.drive_ms) / 1000 : null,
                recover: s.recover_ms != null ? Math.round(s.recover_ms) / 1000 : null,
              }))}
              driveLabel={t("sessions.drive")}
              recoverLabel={t("sessions.recover")}
            />
          </div>
        </Panel>
      )}

      <Panel title={t("sessions.segments")}>
        {!segments.length ? (
          <Hint>{t("sessions.noSegments")}</Hint>
        ) : (
          <DataTable
            headers={["#", t("kind.station"), t("sessions.colTime"), t("chart.vsPrev")]}
            rows={segments.map((seg) => [
              <span className="rx-muted" key="n">
                {seg.seq}
              </span>,
              <span key="name">
                <Chip>{t(`kind.${seg.kind}`)}</Chip>{" "}
                {exName(seg.exercises) ??
                  (seg.kind === "run"
                    ? t("sessions.run1km")
                    : seg.kind === "roxzone"
                      ? t("sessions.transition")
                      : "—")}
                {seg.machine_type && (
                  <small className="rx-muted">
                    {" "}
                    {seg.machine_type === "ski" ? t("sessions.machineSki") : t("sessions.machineRow")}
                    {rawOf(seg)
                      ? ` · ${t("sessions.rawSamples", { n: rawOf(seg)!.sample_count })}`
                      : ` · ${t("sessions.rawNone")}`}
                  </small>
                )}
                {seg.avg_hr != null && (
                  <small className="rx-muted">
                    {" "}
                    ♥{seg.avg_hr}
                    {seg.max_hr != null && `/${seg.max_hr}`}
                  </small>
                )}
              </span>,
              <strong className="rx-number" key="ms">
                {formatMs(seg.split_time_ms)}
              </strong>,
              vsAvg(seg),
            ])}
          />
        )}
      </Panel>

      <AiInsight kind="session" refId={id} />
    </>
  );
}
