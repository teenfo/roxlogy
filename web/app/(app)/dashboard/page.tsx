import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatDateShort, formatMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { CorrelationLine, TrendBars } from "@/components/charts";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.dashboard") };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { t, tag } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: sessions },
    { data: stationSegs },
    { data: simSessions },
    { data: races },
    { data: goals },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase
      .from("sessions")
      .select("id, started_at, total_time_ms, source_device")
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(60),
    supabase
      .from("session_segments")
      .select(
        "exercise_id, split_time_ms, sessions!inner ( deleted_at, started_at )",
      )
      .eq("kind", "station")
      .not("split_time_ms", "is", null)
      .is("sessions.deleted_at", null),
    // 레이스 시뮬(스테이션 포함) 세션만 — 상관 차트·리허설 대비용
    supabase
      .from("sessions")
      .select(
        "id, started_at, total_time_ms, session_segments!inner ( kind, exercise_id, split_time_ms )",
      )
      .is("deleted_at", null)
      .eq("session_segments.kind", "station")
      .order("started_at", { ascending: false })
      .limit(12),
    supabase
      .from("race_results")
      .select("id, event, event_date, total_time_ms")
      .order("event_date", { ascending: true })
      .limit(30),
    supabase
      .from("goal_plans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const all = sessions ?? [];
  const recent = all.slice(0, 3);

  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const weekly = all.filter((s) => new Date(s.started_at) >= monday);
  const weeklyMs = weekly.reduce((acc, s) => acc + (s.total_time_ms ?? 0), 0);

  const pr = new Map<string, number>();
  for (const seg of stationSegs ?? []) {
    if (!seg.exercise_id || seg.split_time_ms == null) continue;
    const cur = pr.get(seg.exercise_id);
    if (cur == null || seg.split_time_ms < cur)
      pr.set(seg.exercise_id, seg.split_time_ms);
  }
  const prs = STATIONS.map((s) => ({
    key: s.key,
    ms: pr.get(s.exerciseId) ?? null,
  }));
  const hasPr = prs.some((p) => p.ms != null);

  const trend = all
    .slice(0, 8)
    .reverse()
    .map((s) => ({
      name: formatDateShort(s.started_at, tag),
      ms: s.total_time_ms ?? 0,
    }));

  // S16 훈련→레이스 상관 시계열: 시뮬 세션 총시간 + 레이스 총시간을 날짜축에 병합
  const sims = (simSessions ?? []) as {
    id: string;
    started_at: string;
    total_time_ms: number | null;
    session_segments: {
      kind: string;
      exercise_id: string | null;
      split_time_ms: number | null;
    }[];
  }[];
  const corrMap = new Map<
    string,
    { date: string; ts: number; sim: number | null; race: number | null }
  >();
  const put = (iso: string, key: "sim" | "race", ms: number | null) => {
    if (ms == null) return;
    const date = formatDateShort(iso, tag);
    const cur = corrMap.get(date) ?? {
      date,
      ts: new Date(iso).getTime(),
      sim: null,
      race: null,
    };
    // 같은 날 여러 건이면 더 빠른(작은) 기록 채택
    cur[key] = cur[key] == null ? ms : Math.min(cur[key]!, ms);
    corrMap.set(date, cur);
  };
  for (const s of sims) put(s.started_at, "sim", s.total_time_ms);
  for (const r of races ?? [])
    if (r.event_date) put(r.event_date, "race", r.total_time_ms);
  const corr = [...corrMap.values()].sort((a, b) => a.ts - b.ts);
  const showCorr =
    corr.some((c) => c.sim != null) && corr.some((c) => c.race != null);

  // S17 리허설 리포트: 최신 목표 vs 최신 시뮬 세션 스테이션별 대비
  const goal = (goals?.[0] ?? null) as {
    target_total_ms: number;
    stations: { key: string; targetMs: number }[] | null;
  } | null;
  const latestSim = sims[0];
  const rehearsal =
    goal?.stations && latestSim
      ? (() => {
          const actual = new Map<string, number>();
          for (const seg of latestSim.session_segments) {
            if (seg.kind !== "station" || !seg.exercise_id || seg.split_time_ms == null)
              continue;
            const st = STATIONS.find((x) => x.exerciseId === seg.exercise_id);
            if (st) actual.set(st.key, seg.split_time_ms);
          }
          const rows = goal.stations
            .map((g) => ({
              key: g.key,
              target: g.targetMs,
              actual: actual.get(g.key) ?? null,
            }))
            .filter((r) => r.actual != null);
          const simTotal = latestSim.total_time_ms ?? null;
          return rows.length
            ? { rows, simTotal, target: goal.target_total_ms }
            : null;
        })()
      : null;

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {profile?.display_name ?? user!.email}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("dash.division")}:{" "}
            {profile?.division
              ? t(`division.${profile.division}` as Parameters<typeof t>[0])
              : t("dash.unset")}{" "}
            ·{" "}
            <Link href="/settings/profile" className="text-accent hover:underline">
              {t("dash.profileSettings")}
            </Link>
          </p>
        </div>
        <Link
          href="/sessions/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          {t("dash.recordSession")}
        </Link>
      </div>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">{t("dash.weekSessions")}</p>
          <p className="mt-1 text-2xl font-bold">
            {t("dash.count", { n: weekly.length })}
          </p>
        </div>
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">{t("dash.weekTime")}</p>
          <p className="mt-1 font-mono text-2xl font-bold">
            {formatMs(weeklyMs)}
          </p>
        </div>
        <div className="col-span-2 rounded-md bg-surface px-4 py-3 sm:col-span-1">
          <p className="text-xs text-muted">{t("dash.totalSessions")}</p>
          <p className="mt-1 text-2xl font-bold">
            {t("dash.count", { n: all.length })}
          </p>
        </div>
      </section>

      {trend.length >= 2 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("dash.trendTitle")}</h2>
          <div className="mt-3 rounded-md bg-surface p-4">
            <TrendBars data={trend} />
          </div>
        </section>
      )}

      {rehearsal && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("dash.rehearsalTitle")}</h2>
          <p className="mt-1 text-sm text-muted">
            {t("dash.rehearsalDesc", {
              target: formatMs(rehearsal.target),
              sim: rehearsal.simTotal ? formatMs(rehearsal.simTotal) : "—",
            })}
          </p>
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
                {rehearsal.rows.map((r) => {
                  const gap = r.actual! - r.target; // 양수 = 목표보다 느림
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
        </section>
      )}

      {showCorr && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("dash.corrTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("dash.corrDesc")}</p>
          <div className="mt-3 rounded-md bg-surface p-4">
            <CorrelationLine
              data={corr}
              simLabel={t("dash.corrSim")}
              raceLabel={t("dash.corrRace")}
            />
          </div>
        </section>
      )}

      {hasPr && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("dash.prTitle")}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {prs.map((p) => (
              <div key={p.key} className="rounded-md bg-surface px-3 py-2.5">
                <p className="truncate text-xs text-muted">
                  {t(`station.${p.key}` as Parameters<typeof t>[0])}
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold">
                  {p.ms != null ? formatMs(p.ms) : "—"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{t("dash.recentTitle")}</h2>
          <Link href="/sessions" className="text-sm text-accent hover:underline">
            {t("dash.viewAll")}
          </Link>
        </div>

        {!recent.length ? (
          <div className="mt-4 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
            <p>{t("dash.empty")}</p>
            <Link
              href="/sessions/new"
              className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
            >
              {t("dash.recordFirst")}
            </Link>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {recent.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="flex items-center justify-between rounded-md bg-surface px-4 py-3 hover:bg-surface/70"
                >
                  <span className="text-sm">{formatDate(s.started_at, tag)}</span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="text-muted">
                      {t(`source.${s.source_device}` as Parameters<typeof t>[0])}
                    </span>
                    <span className="font-mono font-semibold">
                      {formatMs(s.total_time_ms)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
