import Link from "next/link";
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

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("run.title") };
}

type Baseline = {
  baseline_1k_ms: number;
  from_distance_m: number;
  from_ran_on: string;
} | null;

export default async function RunsPage() {
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // "내 기록" 이므로 user_id 필터 필수
  const [{ data, error }, { data: baseline }] = await Promise.all([
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

  return (
    <main>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("run.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("run.desc")}</p>
        </div>
        <Link
          href="/runs/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          {t("run.add")}
        </Link>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error.message}</p>}

      {/* 1km 기준선 — 시뮬 저하율이 비교하는 값 */}
      <section className="mt-6 rounded-md bg-surface px-5 py-4">
        <p className="text-xs text-muted">{t("run.baselineTitle")}</p>
        {base ? (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-3xl font-black">
                {formatMs(base.baseline_1k_ms)}
              </span>
              <span className="text-xs text-muted">
                {t("run.baselineFrom", {
                  distance: formatDistance(base.from_distance_m),
                  date: formatDateShortYear(base.from_ran_on, tag, tz),
                })}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">{t("run.baselineHint")}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">{t("run.baselineNone")}</p>
        )}
      </section>

      {/* 최근 90일 요약 */}
      {recent.length > 0 && (
        <section className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-md bg-surface px-4 py-3">
            <p className="text-xs text-muted">{t("run.summaryTitle")}</p>
            <p className="mt-1 font-mono text-xl font-bold">
              {t("run.summaryRuns", { n: recent.length })}
            </p>
          </div>
          <div className="rounded-md bg-surface px-4 py-3">
            <p className="text-xs text-muted">{t("run.summaryDistance")}</p>
            <p className="mt-1 font-mono text-xl font-bold">
              {formatDistance(totalM)}
            </p>
          </div>
          <div className="rounded-md bg-surface px-4 py-3">
            <p className="text-xs text-muted">{t("run.summaryPace")}</p>
            <p className="mt-1 font-mono text-xl font-bold">
              {formatPace(avgPace)}
              <span className="text-xs font-normal text-muted">
                {t("run.paceUnit")}
              </span>
            </p>
          </div>
        </section>
      )}

      {!rows.length ? (
        <div className="mt-6 rounded-md bg-surface px-4 py-10 text-center">
          <p className="text-sm text-muted">{t("run.empty")}</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted">
            {t("run.emptyHint")}
          </p>
          <Link
            href="/runs/new"
            className="mt-4 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110"
          >
            {t("run.add")}
          </Link>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-bold">
                  {formatDistance(r.distance_m)}
                </span>
                <span className="font-mono text-sm text-muted">
                  {formatMs(r.duration_ms)}
                </span>
                <span className="rounded-full bg-background px-2 py-0.5 font-mono text-xs font-bold text-accent">
                  {formatPace(r.pace_s_per_km)}
                  {t("run.paceUnit")}
                </span>
                <span className="text-[10px] text-muted">
                  {t(kindLabel(r.kind))} · {t(surfaceLabel(r.surface))}
                  {r.incline_pct != null && ` · ${r.incline_pct}%`}
                </span>
                <span className="ml-auto flex items-center gap-3 text-xs text-muted">
                  {formatDateShortYear(r.ran_on, tag, tz)}
                  <Link href={`/runs/${r.id}/edit`} className="hover:text-accent">
                    {t("common.edit")}
                  </Link>
                  <RunDeleteButton id={r.id} />
                </span>
              </div>

              {(r.avg_hr != null || r.rpe != null || r.location) && (
                <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                  {r.avg_hr != null && (
                    <span>
                      {t("run.avgHr")} {r.avg_hr}
                      {r.max_hr != null && ` / ${r.max_hr}`}
                    </span>
                  )}
                  {r.rpe != null && <span>RPE {r.rpe}</span>}
                  {r.location && <span>📍 {r.location}</span>}
                </p>
              )}

              {r.note && (
                <p className="mt-2 whitespace-pre-line text-xs text-muted">
                  {r.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
