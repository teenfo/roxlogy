import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew, getCrewLeaderboard } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShort } from "@/lib/format";

const DIVISIONS = ["open", "pro", "doubles", "pro_doubles", "relay"] as const;

export default async function CrewLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ division?: string }>;
}) {
  const { slug } = await params;
  const { division } = await searchParams;
  const div = DIVISIONS.includes(division as never) ? division! : null;

  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();
  const rows = await getCrewLeaderboard(slug, div, 100);

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs ${
      active
        ? "border-accent text-accent"
        : "border-muted/40 text-muted hover:border-foreground"
    }`;

  return (
    <main>
      <div className="flex flex-wrap gap-2">
        <Link href={`/crews/${slug}/leaderboard`} className={chip(!div)}>
          {t("crew.all")}
        </Link>
        {DIVISIONS.map((d) => (
          <Link
            key={d}
            href={`/crews/${slug}/leaderboard?division=${d}`}
            className={chip(div === d)}
          >
            {d.replace("_", " ").toUpperCase()}
          </Link>
        ))}
      </div>

      {!rows.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-12 text-center text-sm leading-relaxed text-muted">
          {t("crew.emptyLeaderboard")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-px overflow-hidden rounded-md bg-muted/20">
          {rows.map((r) => (
            <li
              key={`${r.user_id}-${r.division ?? "na"}`}
              className="flex items-center gap-3 bg-surface px-4 py-3"
            >
              <span
                className={`w-7 shrink-0 text-center font-mono text-sm font-bold ${
                  r.rank <= 3 ? "text-accent" : "text-muted"
                }`}
              >
                {r.rank}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/u/${r.user_id}`}
                  className="block truncate text-sm font-semibold hover:text-accent"
                >
                  {r.display_name}
                </Link>
                <p className="mt-0.5 text-[11px] text-muted">
                  {r.division?.replace("_", " ").toUpperCase() ?? "—"}
                  {" · "}
                  {r.session_count} {t("crew.sessionCount")}
                  {r.last_at && ` · ${formatDateShort(r.last_at, tag, tz)}`}
                </p>
              </div>
              <span className="shrink-0 font-mono text-lg font-semibold text-accent">
                {formatMs(r.best_ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
