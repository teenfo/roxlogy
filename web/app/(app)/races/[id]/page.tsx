import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Flag } from "lucide-react";
import { AiInsight } from "@/components/ai-insight";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatDateOnly, formatMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { DeleteButton } from "@/components/delete-button";
import { RaceEditForm } from "@/components/race-edit-form";
import { RaceToSessionButton } from "@/components/race-to-session-button";
import {
  RaceReplayTable,
  type ReplayRow,
  type SegHistoryPoint,
} from "@/components/race-replay-table";
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

type RaceSplits = {
  stations?: Record<string, number>;
  run_total_ms?: number;
  /** Race Replay에서 가져온 런 랩 1~8 (ms) */
  runs?: number[];
  /** Race Replay In/Out에서 산출한 록스존 1~8 (ms) */
  roxzones?: number[];
  /** 공식 API 스플릿별 필드 순위 (자동 임포트) */
  stations_place?: Record<string, number>;
  runs_place?: (number | null)[];
  /** 해당 디비전×요일 이벤트 완주자 수 */
  field_size?: number;
  rank_overall?: number;
  /** 배번 — HHMM+순번(4+2): 앞 4자리가 웨이브 출발시각 */
  bib?: string;
};

function delta(raceMs?: number | null, trainMs?: number | null) {
  if (raceMs == null || trainMs == null) return "—";
  const diff = raceMs - trainMs; // 음수 = 레이스가 빠름
  return `${diff <= 0 ? "−" : "+"}${formatMs(Math.abs(diff))}`;
}

/**
 * 레이스 상세 — 시안 records.tsx 의 RecordDetail(race) 그대로 (PORT_PLAN §3-b):
 * Back · PageHead(기록 카드·편집) · .rx-detail-hero(공식 전체 순위) · Stats ·
 * two-col[런 페이스 흐름 | 구간별 기록] · Panel "기록에서 읽을 수 있는 것".
 * 시안에 없는 우리 기능(시뮬 대비표·리플레이표·세션 만들기·AI)은 아래 Panel 로만.
 */
export default async function RaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag, tz } = await getT();

  const { data: race } = await supabase
    .from("race_results")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!race) notFound();

  // 필드 대비 백분위 (공개 집계 분포 기준) — 성별은 본인 프로필에서
  const { data: profile } = await supabase
    .from("profiles")
    .select("gender, display_name")
    .maybeSingle();
  let percentile: number | null = null;
  if (race.division && race.total_time_ms != null) {
    const { data: pct } = await supabase.rpc("race_percentile", {
      p_total_ms: race.total_time_ms,
      p_division: race.division,
      p_gender: profile?.gender ?? null,
    });
    percentile = typeof pct === "number" ? pct : pct == null ? null : Number(pct);
  }

  // 비교 대상: 스테이션 세그먼트가 있는 가장 최근 세션 (레이스 시뮬)
  // 주의: shared 세션은 RLS 로 전체 공개(피드용) — 본인 필터 필수
  const { data: sims } = await supabase
    .from("sessions")
    .select(
      "id, started_at, total_time_ms, session_segments ( kind, exercise_id, split_time_ms )",
    )
    .eq("user_id", race.user_id)
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
  const hasAnySplits = hasStationSplits || (splits.runs?.length ?? 0) > 0;

  // 세그먼트 히스토리: 내 레이스들의 같은 세그먼트 기록 추이 (모달 그래프)
  const { data: myRaces } = hasAnySplits
    ? await supabase
        .from("race_results")
        .select("id, event_date, splits")
        .eq("user_id", race.user_id)
        .not("event_date", "is", null)
        .order("event_date", { ascending: true })
        .limit(30)
    : { data: [] };
  const segHistory: Record<string, SegHistoryPoint[]> = {};
  for (const r of myRaces ?? []) {
    const sp = (r.splits ?? {}) as RaceSplits;
    const date = String(r.event_date).slice(0, 10);
    for (const [key, ms] of Object.entries(sp.stations ?? {})) {
      if (typeof ms !== "number") continue;
      (segHistory[key] ??= []).push({ date, ms });
    }
    (sp.runs ?? []).forEach((ms, i) => {
      if (typeof ms !== "number") return;
      (segHistory[`run_${i + 1}`] ??= []).push({ date, ms });
    });
  }

  const replayRows: ReplayRow[] = STATIONS.map((s, i) => ({
    i: i + 1,
    runMs: splits.runs?.[i] ?? null,
    runPlace: splits.runs_place?.[i] ?? null,
    roxMs: splits.roxzones?.[i] ?? null,
    stationKey: s.key,
    stationLabel: t(`station.${s.key}` as Parameters<typeof t>[0]),
    stMs: splits.stations?.[s.key] ?? null,
    stPlace: splits.stations_place?.[s.key] ?? null,
  }));

  const divisionLabel = race.division
    ? t(`division.${race.division}` as Parameters<typeof t>[0])
    : null;
  const total = race.total_time_ms ?? 0;
  const runTotal =
    splits.run_total_ms ?? (splits.runs?.length ? splits.runs.reduce((a, b) => a + b, 0) : null);
  const stationTotal = hasStationSplits
    ? Object.values(splits.stations!).reduce((a, b) => a + b, 0)
    : null;
  const other =
    runTotal != null && stationTotal != null ? Math.max(0, total - runTotal - stationTotal) : null;
  const pctOf = (ms: number | null) =>
    ms != null && total > 0 ? ((ms / total) * 100).toFixed(1) : null;
  const runs = splits.runs ?? [];
  const sameDivision = (myRaces ?? []).length; // 히스토리 조회는 본인 레이스 전체

  return (
    <>
      <Back href="/races" label={t("races.title")} />
      <PageHead
        title={race.event}
        description={[
          race.event_date ? formatDateOnly(race.event_date, tag) : t("races.noDate"),
          divisionLabel,
          splits.bib ? `BIB ${splits.bib}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="rx-actions">
            <Go href={`/races/${race.id}/share`}>{t("detail.card")}</Go>
            <RaceEditForm
              raceId={race.id}
              event={race.event}
              eventDate={race.event_date ?? null}
              division={race.division ?? null}
              totalMs={race.total_time_ms ?? null}
              bib={splits.bib ?? null}
            />
            <RaceToSessionButton
              raceId={race.id}
              division={race.division ?? null}
              eventDate={race.event_date ?? null}
              bib={splits.bib ?? null}
              splits={splits}
            />
            <DeleteButton kind="race" id={race.id} redirectTo="/races" />
          </div>
        }
      />

      <div className="rx-detail-hero">
        <div>
          {divisionLabel && <Chip tone="yellow">{divisionLabel}</Chip>}
          <p>FINISH TIME</p>
          <strong>{formatMs(race.total_time_ms)}</strong>
        </div>
        <div>
          <span>
            {splits.rank_overall != null && splits.field_size != null
              ? t("detail.overallRank")
              : t("detail.status")}
          </span>
          <h3>
            {splits.rank_overall != null && splits.field_size != null
              ? `${splits.rank_overall} / ${splits.field_size}`
              : percentile != null
                ? t("percentile.top", { pct: String(Math.round(percentile)) })
                : t("detail.finished")}
          </h3>
          <p>
            {t("detail.officialNote")}
            {splits.bib ? ` · BIB ${splits.bib}` : ""}
          </p>
        </div>
      </div>

      <Stats
        items={[
          [
            t("kind.run"),
            runTotal != null ? formatMs(runTotal) : "—",
            pctOf(runTotal) != null ? t("detail.ofTotal", { pct: pctOf(runTotal)! }) : "",
          ],
          [
            t("detail.station"),
            stationTotal != null ? formatMs(stationTotal) : "—",
            pctOf(stationTotal) != null ? t("detail.ofTotal", { pct: pctOf(stationTotal)! }) : "",
          ],
          [t("detail.other"), other != null ? formatMs(other) : "—", t("detail.otherNote")],
          [
            t("detail.sameDivision"),
            String(sameDivision || 1),
            sameDivision > 1 ? "" : t("detail.trendNeedMore"),
          ],
        ]}
      />

      <div className="rx-two-col">
        <Panel title={t("detail.runPace")} action={<Chip>{runs.length} × 1 km</Chip>}>
          {runs.length ? (
            <div className="rx-lap-chart">
              {runs.map((ms, i) => (
                <div key={i}>
                  <span>{formatMs(ms)}</span>
                  <div style={{ height: Math.round(ms / 4000) + "px" }} />
                  <small>RUN {i + 1}</small>
                </div>
              ))}
            </div>
          ) : (
            <Hint>{t("detail.noSplits")}</Hint>
          )}
        </Panel>
        <Panel title={t("detail.splits")}>
          {hasAnySplits ? (
            <DataTable
              headers={[t("detail.round"), t("kind.run"), t("detail.station")]}
              rows={STATIONS.map((s, i) => [
                <span key="s">
                  <small className="rx-muted">{String(i + 1).padStart(2, "0")} </small>
                  {t(`station.${s.key}` as Parameters<typeof t>[0])}
                </span>,
                runs[i] != null ? formatMs(runs[i]) : "—",
                splits.stations?.[s.key] != null ? formatMs(splits.stations[s.key]) : "—",
              ])}
            />
          ) : (
            <Hint>{t("detail.noSplits")}</Hint>
          )}
        </Panel>
      </div>

      <Panel title={t("detail.insights")}>
        {runTotal != null && total > 0 && (
          <div className="rx-insight">
            <Flag />
            <div>
              <h3>{t("detail.runShare", { pct: pctOf(runTotal)! })}</h3>
              <p>{t("detail.runShareNote", { run: formatMs(runTotal), total: formatMs(total) })}</p>
            </div>
          </div>
        )}
        {percentile != null && divisionLabel && (
          <div className="rx-insight">
            <Activity />
            <div>
              <h3>{t("percentile.top", { pct: String(Math.round(percentile)) })}</h3>
              <p>
                {t("detail.percentileNote", {
                  pct: String(Math.round(percentile)),
                  division: divisionLabel,
                })}
              </p>
            </div>
          </div>
        )}
        {sameDivision <= 1 && (
          <div className="rx-insight">
            <Activity />
            <div>
              <h3>{t("detail.trendNeedMore")}</h3>
              <p>{t("goals.compareHint")}</p>
            </div>
          </div>
        )}
      </Panel>

      {/* ── 시안에 없는 우리 기능 (PORT_PLAN §4-1) ── */}
      <Panel
        title={t("races.compareTitle")}
        action={
          sim ? <Chip>{t("races.compareVs", { date: formatDate(sim.started_at, tag, tz) })}</Chip> : undefined
        }
      >
        {!sim ? (
          <Hint>
            {t("races.noSim")} <Link href="/sessions/new">{t("races.noSimLink")}</Link>
          </Hint>
        ) : !hasStationSplits ? (
          <Hint>
            {t("races.totalOnlyCompare", {
              race: formatMs(race.total_time_ms),
              sim: formatMs(sim.total_time_ms),
            })}
          </Hint>
        ) : (
          <>
            <DataTable
              headers={[t("races.colSegment"), t("races.colRace"), t("races.colSim"), t("races.colDiff")]}
              rows={[
                ...(splits.run_total_ms != null
                  ? [[
                      t("races.runTotal"),
                      formatMs(splits.run_total_ms),
                      simRunTotal ? formatMs(simRunTotal) : "—",
                      delta(splits.run_total_ms, simRunTotal || null),
                    ]]
                  : []),
                ...STATIONS.flatMap((s) => {
                  const raceMs = splits.stations?.[s.key];
                  const trainMs = simByExercise.get(s.exerciseId);
                  if (raceMs == null && trainMs == null) return [];
                  return [[
                    t(`station.${s.key}` as Parameters<typeof t>[0]),
                    raceMs != null ? formatMs(raceMs) : "—",
                    trainMs != null ? formatMs(trainMs) : "—",
                    delta(raceMs, trainMs),
                  ]];
                }),
              ]}
            />
            <Hint>{t("races.diffNote")}</Hint>
          </>
        )}
      </Panel>

      {hasAnySplits && (
        <Panel title={t("races.replayTitle")}>
          <div>
            <RaceReplayTable
              rows={replayRows}
              fieldSize={splits.field_size ?? null}
              history={segHistory}
            />
          </div>
        </Panel>
      )}

      <AiInsight kind="race" refId={id} />
    </>
  );
}
