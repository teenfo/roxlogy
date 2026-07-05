import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatDateShort, formatMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { TrendBars } from "@/components/charts";

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

  const [{ data: profile }, { data: sessions }, { data: stationSegs }] =
    await Promise.all([
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
