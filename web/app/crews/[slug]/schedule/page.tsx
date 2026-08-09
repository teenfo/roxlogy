import { notFound } from "next/navigation";
import { getCrew, getCrewSchedule, isActiveMember } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { CrewRsvpButton } from "@/components/crew-rsvp-button";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export default async function CrewSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();
  const events = await getCrewSchedule(slug, 50);
  const canRsvp = isActiveMember(crew);

  if (!events.length)
    return (
      <p className="rounded-md bg-surface px-4 py-12 text-center text-sm text-muted">
        {t("crew.emptySchedule")}
      </p>
    );

  return (
    <main>
      <ul className="flex flex-col gap-2">
        {events.map((e) => {
          const full = e.capacity != null && e.going_count >= e.capacity;
          return (
            <li key={e.id} className="rounded-md bg-surface px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-full border border-track/50 px-2 py-0.5 text-[10px] text-track">
                      {t(`crew.kind.${e.kind}` as DictKey)}
                    </span>
                    <h2 className="truncate text-sm font-semibold">{e.title}</h2>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {formatDate(e.starts_at, tag, tz)}
                    {e.location && ` · ${e.location}`}
                    {e.coach_name && ` · ${t("crew.coach")} ${e.coach_name}`}
                  </p>
                  {e.description && (
                    <p className="mt-2 whitespace-pre-line text-xs text-foreground/80">
                      {e.description}
                    </p>
                  )}
                  <p className="mt-2 font-mono text-xs">
                    <span className={full ? "text-muted" : "text-accent"}>
                      {e.going_count}
                      {e.capacity != null && ` / ${e.capacity}`}
                    </span>
                    <span className="ml-1 text-[10px] text-muted">
                      {t("crew.going")}
                    </span>
                  </p>
                </div>
                <CrewRsvpButton
                  eventId={e.id}
                  status={e.my_status}
                  canRsvp={canRsvp && (!full || e.my_status === "going")}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
