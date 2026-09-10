import Link from "next/link";
import { notFound } from "next/navigation";
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
import { formatDistance, gradeClass, gradeDictKey, type Degradation } from "@/lib/run";
import {
  BreakdownStackBar,
  DriveChart,
  ErgCurve,
  RunLapLine,
  SegmentSplitBars,
  StrokeForceChart,
} from "@/components/charts";
import { CHART_COLORS } from "@/lib/hyrox";
import { DeleteButton } from "@/components/delete-button";
import { ShareToggle } from "@/components/share-toggle";
import { FollowButton } from "@/components/follow-button";

const KIND_BADGE: Record<string, string> = {
  run: "border-track/60 text-track",
  station: "border-accent/60 text-accent",
  roxzone: "border-muted/60 text-muted",
};

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
  const chartData = segments
    .filter((s) => s.split_time_ms != null)
    .map((s) => ({
      name:
        exName(s.exercises) ?? `${t(`kind.${s.kind}`)} ${s.seq}`,
      ms: s.split_time_ms!,
      kind: s.kind,
    }));

  // 에르그 단독 세션(런·록스존 없이 머신 스테이션만) → 전용 화면.
  // 시뮬용 섹션(페이싱·구성비·스플릿 바 등)을 걷어내고 raw 기반 차트를 채운다.
  const isErg =
    segments.length > 0 &&
    segments.every((s) => s.kind === "station") &&
    segments.some((s) => s.machine_type);

  let ergRaws: ErgRawRow[] = [];
  if (isErg) {
    const { data: raws } = await supabase
      .from("erg_samples")
      .select("segment_id, samples, strokes")
      .in(
        "segment_id",
        segments.map((s) => s.id),
      );
    ergRaws = (raws ?? []) as ErgRawRow[];
  }
  const ergSamplesAll = ergRaws.flatMap((r) => r.samples ?? []);
  const ergStrokesAll = ergRaws.flatMap((r) => r.strokes ?? []);

  const raceRaw = (session as { race_results?: unknown }).race_results;
  const race = (Array.isArray(raceRaw) ? raceRaw[0] : raceRaw) as
    | { event: string | null; event_date: string | null; season: string | null; division: string | null }
    | null
    | undefined;

  // 개인 최고(대회) — 히어로의 "PB 대비". 본인 세션에서만 의미가 있다.
  let pbMs: number | null = null;
  if (isOwner) {
    const { data: pbRows } = await supabase
      .from("sessions")
      .select("total_time_ms, race_results!inner ( event )")
      .eq("user_id", session.user_id)
      .is("deleted_at", null)
      .not("total_time_ms", "is", null)
      .order("total_time_ms", { ascending: true })
      .limit(1);
    pbMs = (pbRows ?? [])[0]?.total_time_ms ?? null;
  }
  const pbGap =
    pbMs != null && session.total_time_ms != null
      ? session.total_time_ms - pbMs
      : null;
  const gapLabel = (ms: number) => {
    const d = Math.round(ms / 1000);
    const a = Math.abs(d);
    return `${d >= 0 ? "+" : "−"}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  };

  // 러닝 저하율 — 시뮬 랩이 순수 1km 페이스보다 얼마나 느린가.
  // 본인 세션에서만 계산한다: 기준선은 내 러닝 기록이고 RLS 로 남에겐 안 보인다.
  let degradation: Degradation | null = null;
  if (isOwner && !isErg && runLaps.length >= 2) {
    const { data: deg } = await supabase.rpc("session_run_degradation", {
      p_session: id,
    });
    degradation = (deg ?? null) as Degradation | null;
  }

  // 필드 분포 곡선 — 풀 시뮬(런8+스테이션8, 30분↑) + 본인 세션일 때만.
  // 소유자 프로필(성별·출생연도)로 동체급·동연령 실측 분포에 위치를 찍는다.
  let dist: {
    percentiles: Record<string, number>;
    pct: number;
    byAge: boolean;
    ageGroup: string | null;
  } | null = null;
  const isFullSim =
    !isErg &&
    segments.filter((s) => s.kind === "station").length >= 8 &&
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
      // 백분위와 같은 규칙(표본 하한 포함)으로 고른다 — 다른 행을 쓰면
      // 곡선과 숫자가 서로 다른 분포를 가리킨다
      const bm = pickBenchmark(
        benchmarks as Benchmark[],
        division,
        myProfile?.gender ?? null,
        scope,
      );
      if (bm) {
        dist = {
          percentiles: bm.percentiles,
          pct: best.pct,
          byAge: best.byAge,
          ageGroup,
        };
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
      pace: (s.segment_metrics?.pace_curve ?? []).map(([tt, v]) => ({
        t: tt,
        v,
      })),
      power: (s.segment_metrics?.power_curve ?? []).map(([tt, v]) => ({
        t: tt,
        v,
      })),
    }));

  // 종류별 평균 — 세그먼트 표의 "평균 대비". 런은 런끼리, 스테이션은 스테이션끼리
  // 비교해야 의미가 있다(록스존 2분과 월볼 6분을 같이 평균 내면 무의미).
  const kindAvg = new Map<string, number>();
  for (const k of ["run", "station", "roxzone"]) {
    const xs = segments
      .filter((x) => x.kind === k && x.split_time_ms != null)
      .map((x) => x.split_time_ms!);
    if (xs.length) kindAvg.set(k, xs.reduce((a, v) => a + v, 0) / xs.length);
  }
  // 종류별 가장 느린 구간 — 행을 붉게 표시해 눈에 걸리게 한다
  const worstSeq = new Map<string, number>();
  for (const k of ["run", "station"]) {
    let worst: (typeof segments)[number] | null = null;
    for (const x of segments) {
      if (x.kind !== k || x.split_time_ms == null) continue;
      if (!worst || x.split_time_ms > worst.split_time_ms!) worst = x;
    }
    if (worst) worstSeq.set(k, worst.seq);
  }

  // 랩 추이 헤더 요약 — 평균과 첫 랩 대비 마지막 랩 변화
  const lapMs = runLaps.map((x) => x.split_time_ms!);
  const lapAvg = lapMs.length
    ? Math.round(lapMs.reduce((a, v) => a + v, 0) / lapMs.length)
    : null;
  const lapDrift =
    lapMs.length >= 2 ? lapMs[lapMs.length - 1] - lapMs[0] : null;

  return (
    <main className="flex flex-col gap-[22px]">
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <Link
          href={isOwner ? "/sessions" : "/feed"}
          className="text-muted hover:text-foreground"
        >
          ← {isOwner ? t("sessions.back") : t("feed.back")}
        </Link>
        {isOwner ? (
          <div className="flex items-center gap-2">
            <ShareToggle id={session.id} shared={session.shared} />
            <Link
              href={`/sessions/${session.id}/edit`}
              className="flex h-8 items-center rounded-lg border border-line-strong px-3 font-semibold text-foreground/80 hover:border-muted/60"
            >
              {t("sessions.edit")}
            </Link>
            <DeleteButton kind="session" id={session.id} redirectTo="/sessions" />
          </div>
        ) : (
          <FollowButton authorId={session.user_id} />
        )}
      </div>

      {/* 히어로 */}
      <section className="grid items-end gap-6 rounded-2xl border border-line-accent bg-highlight px-6 py-5 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {race ? (
              <span className="rounded-md bg-[#2a2500] px-2 py-0.5 text-[11px] font-bold text-accent-dim">
                {t("sessions.race")}
              </span>
            ) : isErg ? (
              <span className="rounded-md bg-info-bg px-2 py-0.5 text-[11px] font-bold text-info">
                ⚡ {t("sessions.ergDedicated")}
              </span>
            ) : (
              <span className="rounded-md bg-label-bg px-2 py-0.5 text-[11px] font-bold text-label">
                {t("sessions.typeSim")}
              </span>
            )}
            {(race?.division ?? session.division) && (
              <span className="rounded bg-label-bg px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-label">
                {t(
                  `division.${race?.division ?? session.division}` as Parameters<typeof t>[0],
                )}
              </span>
            )}
            <span className="text-xs text-muted">
              {race?.season ? `${race.season} · ` : ""}
              {t("sessions.recordedVia", {
                device: t(
                  `source.${session.source_device}` as Parameters<typeof t>[0],
                ),
              })}
            </span>
          </div>
          <h1 className="mt-2 truncate text-[26px] font-extrabold">
            {race?.event ?? formatDate(session.started_at, tag, tz)}
          </h1>
          {race?.event && (
            <p className="mt-1 text-sm text-foreground/75">
              {formatDate(session.started_at, tag, tz)}
            </p>
          )}
        </div>

        <div className="sm:text-right">
          <p className="tabular text-[44px] font-extrabold leading-none tracking-tight text-accent">
            {formatMs(session.total_time_ms)}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2.5 text-[13px] sm:justify-end">
            {pbGap != null && (
              <span
                className={`tabular font-bold ${pbGap <= 0 ? "text-accent" : "text-danger"}`}
              >
                {pbGap <= 0 ? t("sessions.pb") : `PB ${gapLabel(pbGap)}`}
              </span>
            )}
            {dist && (
              <span className="text-muted">
                {t("sessions.distTop", { pct: dist.pct })}
              </span>
            )}
          </p>
        </div>
      </section>

      {/* 연결 프로그램 · RPE · 노트 */}
      {(linked || (isOwner && (session.rpe != null || session.notes))) && (
        <section className="rounded-2xl border border-line bg-card px-5 py-4">
          {linked && (
            <p className="text-sm">
              <span className="text-muted">{t("sessions.partOfProgram")} </span>
              {linked.program_days?.programs ? (
                <Link
                  href={`/programs/${linked.program_days.programs.id}`}
                  className="text-accent hover:underline"
                >
                  {linked.program_days.programs.title}
                  {linked.program_days.day_index != null
                    ? ` · ${t("programs.dayN", { n: linked.program_days.day_index })}`
                    : ""}
                  {` · ${linked.title}`}
                </Link>
              ) : (
                <span className="text-foreground/90">{linked.title}</span>
              )}
            </p>
          )}
          {isOwner && session.rpe != null && (
            <div className={`flex items-center gap-2 text-sm ${linked ? "mt-2" : ""}`}>
              <span className="text-muted">{t("sessions.rpe")}</span>
              <span className="tabular rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                {t("sessions.rpeValue", { n: session.rpe })}
              </span>
            </div>
          )}
          {isOwner && session.notes && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">
              {session.notes}
            </p>
          )}
        </section>
      )}

      {isErg && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.ergDistance")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {ergDist != null ? `${Math.round(ergDist)} m` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.ergAvgPower")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {ergMetrics?.avg_power != null
                ? `${Math.round(Number(ergMetrics.avg_power))} W`
                : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.ergAvgPace")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {ergMetrics?.avg_pace_500 != null
                ? `${fmtPace(Number(ergMetrics.avg_pace_500))} /500m`
                : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.ergAvgSpm")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {ergMetrics?.avg_spm != null
                ? Math.round(Number(ergMetrics.avg_spm))
                : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.ergStrokes")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {ergStrokesAll.length || "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.ergAvgWork")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {ergAvgWork != null ? `${Math.round(ergAvgWork)} J` : "—"}
            </p>
          </div>
        </section>
      )}

      {!isErg && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.pacing")}</p>
            <p className="mt-1 text-lg font-semibold">
              {grade ? t(`pacing.${grade}`) : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.runLapDeviation")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {deviation != null
                ? t("sessions.deviationSec", { n: Math.round(deviation / 1000) })
                : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.roxzoneTotal")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {roxzoneMs ? formatMs(roxzoneMs) : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.longestTransition")}</p>
            <p className="tabular mt-1 text-xl font-extrabold">
              {slowestZone ? formatMs(slowestZone.ms) : "—"}
            </p>
          </div>
        </section>
      )}

      {!isErg && share.totalMs > 0 && (
        <section>
          <h2 className="text-[15px] font-extrabold">{t("sessions.timeComposition")}</h2>
          <div className="mt-3">
            <BreakdownStackBar
              runMs={share.runMs}
              stationMs={share.stationMs}
              roxzoneMs={share.roxzoneMs}
            />
          </div>
        </section>
      )}

      {/* 필드 분포 + 런 랩 추이 — 나란히 봐야 "느렸는가"와 "흔들렸는가"가 같이 읽힌다 */}
      {(dist || (!isErg && runLaps.length >= 2)) && (
        <section className="grid gap-3 md:grid-cols-2">
          {dist && (
          <DistributionCurve
            percentiles={dist.percentiles}
            myMs={session.total_time_ms!}
            pct={dist.pct}
            caption={
              dist.byAge && dist.ageGroup
                ? t("dist.captionAge", {
                    division: t(
                      `division.${(session.division as string | null) ?? "open"}` as Parameters<
                        typeof t
                      >[0],
                    ),
                    age: dist.ageGroup,
                  })
                : t("dist.caption", {
                    division: t(
                      `division.${(session.division as string | null) ?? "open"}` as Parameters<
                        typeof t
                      >[0],
                    ),
                  })
            }
          />
        )}
          {!isErg && runLaps.length >= 2 && (
            <div className="rounded-2xl border border-line bg-card px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-[15px] font-extrabold">
                  {t("sessions.runLapTrend")}
                </h2>
                <span className="text-xs text-muted">
                  1km · {t("sessions.lapCount", { n: runLaps.length })}
                </span>
                <span className="tabular ml-auto text-xs text-muted">
                  {lapAvg != null && (
                    <>
                      {t("sessions.lapAvg")}{" "}
                      <b className="font-bold text-foreground">
                        {formatMs(lapAvg)}
                      </b>
                    </>
                  )}
                  {lapDrift != null && (
                    <span className={lapDrift > 0 ? "text-danger" : "text-success"}>
                      {" · "}
                      {lapDrift >= 0 ? "+" : "−"}
                      {formatMs(Math.abs(lapDrift))}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-2">
                <RunLapLine
                  data={runLaps.map((seg, i) => ({
                    name: t("sessions.lapN", { n: i + 1 }),
                    ms: seg.split_time_ms!,
                  }))}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {!isErg && chartData.length > 1 && (
        <section>
          <h2 className="text-[15px] font-extrabold">{t("sessions.segmentSplits")}</h2>
          <div className="mt-3 rounded-xl border border-line bg-card p-4">
            <SegmentSplitBars data={chartData} />
          </div>
        </section>
      )}

      {degradation && (
        <section>
          <h2 className="text-[15px] font-extrabold">{t("run.degTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("run.degDesc")}</p>
          <div className="mt-3 rounded-xl border border-line bg-card px-5 py-4">
            {degradation.degradation_pct == null ? (
              <div>
                <p className="text-sm text-muted">{t("run.degNone")}</p>
                <Link
                  href="/runs/new"
                  className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
                >
                  {t("run.add")}
                </Link>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="font-mono text-3xl font-black">
                    {t("run.degSlower", { pct: degradation.degradation_pct })}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${gradeClass(degradation.grade)}`}
                  >
                    {t(gradeDictKey(degradation.grade))}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                  <span>
                    {t("run.degLap")}{" "}
                    <span className="font-mono text-foreground">
                      {formatMs(degradation.sim_lap_avg_ms)}
                    </span>
                  </span>
                  <span>
                    {t("run.degBaseline")}{" "}
                    <span className="font-mono text-foreground">
                      {formatMs(degradation.baseline!.baseline_1k_ms)}
                    </span>
                  </span>
                  <Link href="/runs" className="hover:text-accent">
                    {t("run.baselineFrom", {
                      distance: formatDistance(
                        degradation.baseline!.from_distance_m,
                      ),
                      date: formatDateShortYear(
                        degradation.baseline!.from_ran_on,
                        tag,
                        tz,
                      ),
                    })}
                  </Link>
                </div>
                <p className="mt-3 text-xs text-muted">{t("run.gradeHint")}</p>
              </>
            )}
          </div>
        </section>
      )}

      {ergSegments.length > 0 && (
        <section>
          <h2 className="text-[15px] font-extrabold">{t("sessions.ergCurves")}</h2>
          <p className="mt-1 text-sm text-muted">{t("sessions.ergCurvesDesc")}</p>
          <div className="mt-3 flex flex-col gap-4">
            {ergSegments.map((e) => (
              <div key={e.key} className="rounded-xl border border-line bg-card p-4">
                <p className="text-sm font-semibold">{e.name}</p>
                {e.power.length > 1 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted">{t("sessions.powerCurve")}</p>
                    <ErgCurve data={e.power} color={CHART_COLORS.station} unit="W" />
                  </div>
                )}
                {e.pace.length > 1 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted">{t("sessions.paceCurve")}</p>
                    <ErgCurve data={e.pace} color={CHART_COLORS.run} unit="/500m" />
                  </div>
                )}
                {isErg && spmCurve.length > 1 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted">{t("sessions.spmCurve")}</p>
                    <ErgCurve data={spmCurve} color="#35C26B" unit="spm" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 스트로크 분석 — PM5 0x0035 스트로크 이벤트 (있을 때만) */}
      {isErg && ergStrokesAll.length > 1 && (
        <section>
          <h2 className="text-[15px] font-extrabold">{t("sessions.strokeSection")}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-card px-4 py-3.5">
              <p className="text-xs text-muted">{t("sessions.avgDriveLen")}</p>
              <p className="tabular mt-1 text-xl font-extrabold">
                {ergAvgDriveLen != null ? `${ergAvgDriveLen.toFixed(2)} m` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-card px-4 py-3.5">
              <p className="text-xs text-muted">{t("sessions.avgStrokeDist")}</p>
              <p className="tabular mt-1 text-xl font-extrabold">
                {ergAvgStrokeDist != null
                  ? `${ergAvgStrokeDist.toFixed(2)} m`
                  : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-card px-4 py-3.5">
              <p className="text-xs text-muted">{t("sessions.driveRatio")}</p>
              <p className="tabular mt-1 text-xl font-extrabold">
                {ergDriveMs != null && ergRecoverMs != null && ergDriveMs > 0
                  ? `1 : ${(ergRecoverMs / ergDriveMs).toFixed(2)}`
                  : "—"}
              </p>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-line bg-card p-4">
            <p className="text-xs text-muted">{t("sessions.strokeForce")}</p>
            <StrokeForceChart
              data={ergStrokesAll.map((s) => ({
                n: s.n,
                peak: s.peak_force,
                avg: s.avg_force,
              }))}
              peakLabel={t("sessions.peakForce")}
              avgLabel={t("sessions.avgForce")}
            />
          </div>
          <div className="mt-3 rounded-xl border border-line bg-card p-4">
            <p className="text-xs text-muted">{t("sessions.driveAnalysis")}</p>
            <DriveChart
              data={ergStrokesAll.map((s) => ({
                n: s.n,
                drive: s.drive_ms != null ? Math.round(s.drive_ms) / 1000 : null,
                recover:
                  s.recover_ms != null ? Math.round(s.recover_ms) / 1000 : null,
              }))}
              driveLabel={t("sessions.drive")}
              recoverLabel={t("sessions.recover")}
            />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[15px] font-extrabold">{t("sessions.segments")}</h2>
        {!segments.length ? (
          <p className="mt-4 rounded-xl border border-line bg-card px-4 py-10 text-center text-sm text-muted">
            {t("sessions.noSegments")}
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-1.5">
            {segments.map((seg) => (
              <li
                key={seg.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${
                  worstSeq.get(seg.kind) === seg.seq
                    ? "border-danger-line bg-danger-card"
                    : "border-line bg-card"
                }`}
              >
                <span className="tabular w-6 text-right text-xs text-muted">
                  {seg.seq}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-xs ${KIND_BADGE[seg.kind] ?? ""}`}
                >
                  {t(`kind.${seg.kind}`)}
                </span>
                <span className="flex-1 text-sm">
                  {exName(seg.exercises) ??
                    (seg.kind === "run"
                      ? t("sessions.run1km")
                      : seg.kind === "roxzone"
                        ? t("sessions.transition")
                        : "—")}
                  {seg.machine_type && (
                    <span className="ml-2 text-xs text-muted">
                      {seg.machine_type === "ski"
                        ? t("sessions.machineSki")
                        : t("sessions.machineRow")}
                      {rawOf(seg)
                        ? ` · ${t("sessions.rawSamples", { n: rawOf(seg)!.sample_count })}`
                        : ` · ${t("sessions.rawNone")}`}
                    </span>
                  )}
                </span>
                {seg.segment_metrics?.avg_power != null && (
                  <span className="tabular text-xs text-muted">
                    {Math.round(Number(seg.segment_metrics.avg_power))}W
                  </span>
                )}
                {seg.avg_hr != null && (
                  <span className="tabular text-xs text-danger">
                    ♥{seg.avg_hr}
                    {seg.max_hr != null && `/${seg.max_hr}`}
                  </span>
                )}
                {(() => {
                  const avg = kindAvg.get(seg.kind);
                  if (avg == null || seg.split_time_ms == null) return null;
                  const d = Math.round((seg.split_time_ms - avg) / 1000);
                  if (Math.abs(d) < 1) return null;
                  const a = Math.abs(d);
                  const txt = `${d > 0 ? "+" : "−"}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
                  return (
                    <span
                      className={`tabular hidden w-14 text-right text-[13px] font-semibold sm:block ${
                        d > 30 ? "text-danger" : d < -30 ? "text-success" : "text-muted"
                      }`}
                    >
                      {txt}
                    </span>
                  );
                })()}
                <span className="tabular w-16 text-right text-sm font-bold">
                  {formatMs(seg.split_time_ms)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <AiInsight kind="session" refId={id} />
    </main>
  );
}
