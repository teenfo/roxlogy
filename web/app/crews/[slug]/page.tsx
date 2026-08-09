import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew, getCrewBoard, getCrewSchedule } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const crew = await getCrew(slug);
  if (!crew) return { title: "Crew" };
  return {
    title: `${crew.name} — ${crew.tagline ?? "Crew"}`,
    description: crew.description?.slice(0, 160),
  };
}

export default async function CrewHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  const [posts, events] = await Promise.all([
    getCrewBoard(slug, null, 5),
    getCrewSchedule(slug, 3),
  ]);

  const links = crew.links ?? {};
  const info: { label: string; value: string; href?: string }[] = [];
  if (crew.location)
    info.push({ label: t("crew.location"), value: crew.location });
  if (links.hours_weekday || links.hours_weekend)
    info.push({
      label: t("crew.hours"),
      value: [links.hours_weekday, links.hours_weekend]
        .filter(Boolean)
        .join(" · "),
    });
  if (links.phone) info.push({ label: t("crew.contact"), value: links.phone });
  if (links.official)
    info.push({
      label: t("crew.official"),
      value: links.official,
      href: links.official,
    });

  return (
    <main className="flex flex-col gap-8">
      {crew.description && (
        <section>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {crew.description}
          </p>
        </section>
      )}

      {!!info.length && (
        <section className="grid gap-px overflow-hidden rounded-md bg-muted/20 sm:grid-cols-2">
          {info.map((row) => (
            <div key={row.label} className="bg-surface px-4 py-3">
              <p className="text-[11px] tracking-wide text-muted">{row.label}</p>
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-0.5 block truncate text-sm text-accent hover:underline"
                >
                  {row.value}
                </a>
              ) : (
                <p className="mt-0.5 text-sm">{row.value}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 다가오는 일정 */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">{t("crew.schedule")}</h2>
          <Link
            href={`/crews/${slug}/schedule`}
            className="text-xs text-muted hover:text-accent"
          >
            {t("crew.viewAll")} →
          </Link>
        </div>
        {!events.length ? (
          <p className="mt-3 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            {t("crew.emptySchedule")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{e.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t(`crew.kind.${e.kind}` as DictKey)} ·{" "}
                    {formatDate(e.starts_at, tag, tz)}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm text-accent">
                  {e.going_count}
                  <span className="ml-1 text-[10px] text-muted">
                    {t("crew.going")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 최근 글 */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">{t("crew.board")}</h2>
          <Link
            href={`/crews/${slug}/board`}
            className="text-xs text-muted hover:text-accent"
          >
            {t("crew.viewAll")} →
          </Link>
        </div>
        {!posts.length ? (
          <p className="mt-3 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            {t("crew.emptyBoard")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {posts.map((p) => (
              <li key={p.id} className="rounded-md bg-surface px-4 py-3">
                <Link
                  href={`/crews/${slug}/board/${p.id}`}
                  className="flex items-center gap-2"
                >
                  <span className="shrink-0 rounded-full border border-muted/40 px-2 py-0.5 text-[10px] text-muted">
                    {t(`crew.cat.${p.category}` as DictKey)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-accent">
                    {p.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {p.author_name}
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
