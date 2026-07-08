import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatMs } from "@/lib/format";
import { percentileOf, type Benchmark } from "@/lib/percentile";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.races") };
}

export default async function RacesPage() {
  const supabase = await createClient();
  const { t } = await getT();
  const [{ data: races }, { data: profile }, { data: benchmarks }] =
    await Promise.all([
      supabase
        .from("race_results")
        .select("id, event, event_date, division, total_time_ms")
        .order("event_date", { ascending: false }),
      supabase.from("profiles").select("gender").maybeSingle(),
      supabase
        .from("race_benchmarks")
        .select("division, gender, scope, percentiles"),
    ]);
  const bms = (benchmarks ?? []) as Benchmark[];
  const gender = profile?.gender ?? null;

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("races.title")}</h1>
        <Link
          href="/races/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          {t("races.register")}
        </Link>
      </div>

      <section className="mt-4 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm">
        <p className="font-semibold">{t("races.findTitle")}</p>
        <p className="mt-1 text-muted">{t("races.findDesc")}</p>
        <a
          href="https://results.hyrox.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-track hover:underline"
        >
          {t("races.findLink")}
        </a>
      </section>

      {!races?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("races.empty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {races.map((r) => {
            const pct = percentileOf(r.total_time_ms, r.division, gender, bms);
            return (
              <li key={r.id}>
                <Link
                  href={`/races/${r.id}`}
                  className="flex items-center justify-between rounded-md bg-surface px-4 py-3.5 hover:bg-surface/70"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">{r.event}</span>
                    <span className="text-xs text-muted">
                      {r.event_date ?? t("races.noDate")} ·{" "}
                      {r.division
                        ? t(`division.${r.division}` as Parameters<typeof t>[0])
                        : "—"}
                    </span>
                  </div>
                  <span className="flex items-center gap-3">
                    {pct != null && (
                      <span className="rounded-full bg-track/15 px-2 py-0.5 text-xs font-semibold text-track">
                        {t("percentile.top", { pct: String(Math.round(pct)) })}
                      </span>
                    )}
                    <span className="font-mono text-lg font-semibold text-accent">
                      {formatMs(r.total_time_ms)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
