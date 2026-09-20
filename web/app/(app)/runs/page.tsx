import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShortYear, todayISOIn } from "@/lib/format";
import {
  formatDistance,
  formatPace,
  kindLabel,
  surfaceLabel,
  type Run,
} from "@/lib/run";
import { RunDeleteButton } from "@/components/run-form";
import { RecordCardButton } from "@/components/record-card-button";
import type { RecordCardData } from "@/lib/record-card";
import { DataTable, Empty, Go, Hint, PageHead, Panel, Stats } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("run.title") };
}

type Baseline = {
  baseline_1k_ms: number;
  from_distance_m: number;
  from_ran_on: string;
} | null;

/**
 * 러닝 기록 — 시안 training.tsx 의 Runs 그대로 (PORT_PLAN §3-c):
 * PageHead(러닝 기록) · Panel "러닝 타임라인" DataTable[날짜·코스·거리·시간·평균 페이스·편집] · Empty.
 * 1km 기준선·90일 요약은 시안에 없는 우리 정보 — Stats 로(§4-1).
 */
export default async function RunsPage() {
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // "내 기록" 이므로 user_id 필터 필수
  const [{ data, error }, { data: baseline }, { data: profile }] = await Promise.all([
    supabase
      .from("runs")
      .select(
        "id, ran_on, kind, surface, distance_m, duration_ms, pace_s_per_km, incline_pct, avg_hr, max_hr, rpe, location, note",
      )
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .order("ran_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.rpc("run_1k_baseline", { p_as_of: todayISOIn(tz) }),
    supabase.from("profiles").select("display_name").eq("id", user!.id).maybeSingle(),
  ]);

  const rows = (data ?? []) as Run[];
  const base = (baseline ?? null) as Baseline;

  // 최근 90일 요약 — "오늘" 은 사용자 시간대 기준 (서버 new Date() 는 UTC)
  const cutoff = new Date(todayISOIn(tz) + "T00:00:00");
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const recent = rows.filter((r) => r.ran_on >= cutoffISO);
  const totalM = recent.reduce((a, r) => a + r.distance_m, 0);
  const totalMs = recent.reduce((a, r) => a + r.duration_ms, 0);
  const avgPace = totalM > 0 ? totalMs / totalM : null;

  const athlete = profile?.display_name?.trim() || "Athlete";
  /** 기록지 — 사진은 브라우저에서만 합성한다(업로드하지 않음) */
  const cardFor = (r: Run): RecordCardData => ({
    kind: "RUN",
    athlete,
    subtitle: [
      formatDateShortYear(r.ran_on, tag, tz),
      `${t(kindLabel(r.kind))} · ${t(surfaceLabel(r.surface))}`,
      r.incline_pct != null ? `${r.incline_pct}%` : null,
      r.location || null,
    ]
      .filter(Boolean)
      .join(" · "),
    mainLabel: formatDistance(r.distance_m),
    mainValue: formatMs(r.duration_ms),
    stats: [
      { label: t("run.summaryPace"), value: `${formatPace(r.pace_s_per_km)}${t("run.paceUnit")}` },
      ...(r.avg_hr != null ? [{ label: t("run.avgHr"), value: String(r.avg_hr) }] : []),
      ...(r.rpe != null ? [{ label: "RPE", value: String(r.rpe) }] : []),
    ],
  });

  return (
    <>
      <PageHead
        title={t("run.title")}
        description={t("run.intro")}
        action={
          <Go href="/runs/new" primary>
            <Plus size={16} />
            {t("run.add")}
          </Go>
        }
      />
      {error && (
        <p role="alert" className="rx-error">
          {error.message}
        </p>
      )}
      <Stats
        items={[
          [
            t("run.baselineTitle"),
            base ? formatMs(base.baseline_1k_ms) : "—",
            base
              ? t("run.baselineFrom", {
                  distance: formatDistance(base.from_distance_m),
                  date: formatDateShortYear(base.from_ran_on, tag, tz),
                })
              : t("run.baselineNone"),
          ],
          [t("run.summaryTitle"), t("run.summaryRuns", { n: recent.length }), ""],
          [t("run.summaryDistance"), formatDistance(totalM), t("run.summaryTitle")],
          [
            t("run.summaryPace"),
            avgPace != null ? `${formatPace(avgPace)}${t("run.paceUnit")}` : "—",
            t("run.summaryTitle"),
          ],
        ]}
      />
      <Panel title={t("run.timeline")}>
        {rows.length ? (
          <>
            <DataTable
              headers={[
                t("run.date"),
                t("run.kind"),
                t("run.distance"),
                t("run.duration"),
                t("run.pace"),
                "",
              ]}
              rows={rows.map((r) => [
                <span key="d">
                  {formatDateShortYear(r.ran_on, tag, tz)}
                  {r.location && <small className="rx-block rx-muted">{r.location}</small>}
                </span>,
                <span key="k">
                  {t(kindLabel(r.kind))} · {t(surfaceLabel(r.surface))}
                  {r.incline_pct != null && ` · ${r.incline_pct}%`}
                  {(r.avg_hr != null || r.rpe != null) && (
                    <small className="rx-block rx-muted">
                      {r.avg_hr != null && `${t("run.avgHr")} ${r.avg_hr}`}
                      {r.avg_hr != null && r.rpe != null && " · "}
                      {r.rpe != null && `RPE ${r.rpe}`}
                    </small>
                  )}
                </span>,
                <strong className="rx-number" key="dist">
                  {formatDistance(r.distance_m)}
                </strong>,
                <strong className="rx-number" key="t">
                  {formatMs(r.duration_ms)}
                </strong>,
                <span className="rx-number" key="p">
                  {formatPace(r.pace_s_per_km)}
                  {t("run.paceUnit")}
                </span>,
                <span className="rx-actions" key="a">
                  <Go href={`/runs/${r.id}/edit`}>{t("common.edit")}</Go>
                  <RecordCardButton data={cardFor(r)} />
                  <RunDeleteButton id={r.id} />
                </span>,
              ])}
            />
            <Hint>{t("run.baselineHint")}</Hint>
          </>
        ) : (
          <Empty
            title={t("run.empty")}
            description={t("run.emptyHint")}
            action={
              <Go href="/runs/new" primary>
                {t("run.firstRun")}
              </Go>
            }
          />
        )}
      </Panel>
    </>
  );
}
