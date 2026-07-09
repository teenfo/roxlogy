import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.events"), description: t("events.desc") };
}

const REGIONS = [
  "asia",
  "europe",
  "north_america",
  "south_america",
  "africa",
  "oceania",
] as const;

function formatRange(
  start: string | null,
  end: string | null,
  note: string | null,
  tag: string,
  tbd: string,
) {
  if (!start) return note ?? tbd;
  const s = new Date(start);
  const fmt = (d: Date) =>
    d.toLocaleDateString(tag, { year: "numeric", month: "long", day: "numeric" });
  if (!end || end === start) return fmt(s);
  const e = new Date(end);
  const sameMonth =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  return sameMonth
    ? `${fmt(s)} – ${e.getDate()}`
    : `${fmt(s)} – ${fmt(e)}`;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string }>;
}) {
  const { q, region } = await searchParams;
  const supabase = await createClient();
  const { t, tag } = await getT();

  let query = supabase
    .from("race_events")
    .select("*")
    .order("start_date", { ascending: true, nullsFirst: false });
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},city.ilike.${term},country.ilike.${term}`);
  }
  if (region && (REGIONS as readonly string[]).includes(region))
    query = query.eq("region", region);

  const { data: events } = await query;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (events ?? []).filter((e) => !e.end_date || e.end_date >= today);
  const past = (events ?? []).filter((e) => e.end_date && e.end_date < today);

  return (
    <>
      <header className="border-b border-surface">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-black tracking-widest">ROXLOGY</span>
          </Link>
          <div className="flex items-center gap-4">
            <LocaleSwitcher compact />
            <Link
              href="/login"
              className="text-sm text-muted hover:text-foreground"
            >
              {t("common.login")}
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-bold">{t("events.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("events.desc")}</p>

        <form method="get" className="mt-6 flex flex-wrap gap-3">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("events.searchPh")}
            className="min-w-52 flex-1 rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <select
            name="region"
            defaultValue={region ?? ""}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="">{t("events.allRegions")}</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {t(`events.region.${r}`)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110"
          >
            {t("common.search")}
          </button>
        </form>

        {!upcoming.length && !past.length ? (
          <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
            {t("events.noResults")}
          </p>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-semibold">{t("events.upcoming")}</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {upcoming.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-4 py-3.5"
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          {e.name}
                          {e.country === "대한민국" && (
                            <span className="ml-2 rounded border border-accent/60 px-1.5 py-0.5 text-xs text-accent">
                              {t("events.koreaBadge")}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {e.city}, {e.country}
                          {e.venue ? ` · ${e.venue}` : ""}
                          {e.region
                            ? ` · ${t(`events.region.${e.region}` as Parameters<typeof t>[0])}`
                            : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm">
                          {formatRange(
                            e.start_date,
                            e.end_date,
                            e.date_note,
                            tag,
                            t("events.tbd"),
                          )}
                        </p>
                        <div className="mt-1 flex items-center justify-end gap-3">
                          {e.official_url && (
                            <a
                              href={e.official_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-track hover:underline"
                            >
                              {t("events.official")}
                            </a>
                          )}
                          <Link
                            href={`/predict?event=${encodeURIComponent(e.name)}${
                              e.start_date ? `&date=${e.start_date}` : ""
                            }`}
                            className="rounded-md border border-accent/50 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10"
                          >
                            {t("events.setGoal")}
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {past.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-semibold text-muted">
                  {t("events.past")}
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {past.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between rounded-md bg-surface/60 px-4 py-3 text-muted"
                    >
                      <span className="text-sm">
                        {e.name} — {e.city}, {e.country}
                      </span>
                      <span className="text-xs">
                        {formatRange(
                          e.start_date,
                          e.end_date,
                          e.date_note,
                          tag,
                          t("events.tbd"),
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <p className="mt-8 text-xs text-muted">
          {t("events.disclaimer.before")}
          <a
            href="https://hyrox.com/find-my-race/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-track hover:underline"
          >
            {t("events.disclaimer.link")}
          </a>
          {t("events.disclaimer.after")}
        </p>
      </main>
    </>
  );
}
