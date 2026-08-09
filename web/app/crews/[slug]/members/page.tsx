import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew, getCrewRoster } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export default async function CrewMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();
  const roster = await getCrewRoster(slug);

  if (!roster.length)
    return (
      <p className="rounded-md bg-surface px-4 py-12 text-center text-sm text-muted">
        {t("crew.emptyRoster")}
      </p>
    );

  return (
    <main>
      <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-muted/20">
        {roster.map((m) => (
          <li
            key={m.user_id}
            className="flex items-center gap-3 bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/u/${m.user_id}`}
                className="block truncate text-sm font-semibold hover:text-accent"
              >
                {m.display_name}
              </Link>
              <p className="mt-0.5 text-[11px] text-muted">
                {m.division?.replace("_", " ").toUpperCase() ?? "—"} ·{" "}
                {formatDateShort(m.joined_at, tag, tz)}
              </p>
            </div>
            {m.role !== "member" && (
              <span className="shrink-0 rounded-full border border-accent/40 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {t(`crew.role.${m.role}` as DictKey)}
              </span>
            )}
            <span className="w-12 shrink-0 text-right font-mono text-sm text-muted">
              {m.session_count}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
