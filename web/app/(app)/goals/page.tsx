import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShort, formatMs } from "@/lib/format";
import { GoalDeleteButton } from "@/components/goal-delete-button";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("goals.title") };
}

type Goal = {
  id: string;
  created_at: string;
  target_total_ms: number;
  run_total_ms: number | null;
  station_total_ms: number | null;
  roxzone_total_ms: number | null;
  level: string | null;
  division: string | null;
  event_name: string | null;
  event_date: string | null;
  stations: { key: string; targetMs: number }[] | null;
};

export default async function GoalsPage() {
  const supabase = await createClient();
  const { t, tag } = await getT();

  const { data } = await supabase
    .from("goal_plans")
    .select("*")
    .order("created_at", { ascending: false });
  const goals = (data ?? []) as Goal[];

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("goals.title")}</h1>
        <Link
          href="/predict"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          {t("goals.new")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">{t("goals.desc")}</p>

      {!goals.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("goals.empty")}{" "}
          <Link href="/predict" className="text-accent hover:underline">
            {t("goals.new")}
          </Link>
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {goals.map((g) => (
            <li key={g.id} className="rounded-md bg-surface px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xl font-bold text-accent">
                      {formatMs(g.target_total_ms)}
                    </span>
                    {g.division && (
                      <span className="rounded-full bg-track/15 px-2 py-0.5 text-xs font-semibold text-track">
                        {t(`division.${g.division}` as Parameters<typeof t>[0])}
                      </span>
                    )}
                    {g.level && (
                      <span className="text-xs text-muted">
                        {t(`predict.level.${g.level}` as Parameters<typeof t>[0])}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {g.event_name ? `${g.event_name}` : t("goals.noEvent")}
                    {g.event_name && g.event_date ? ` · ${g.event_date}` : ""}
                    {" · "}
                    {t("goals.savedOn", {
                      date: formatDateShort(g.created_at, tag),
                    })}
                  </p>
                </div>
                <GoalDeleteButton goalId={g.id} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-background px-2 py-1">
                  {t("predict.runPerKm")}:{" "}
                  <span className="font-mono font-semibold text-track">
                    {formatMs(g.run_total_ms)}
                  </span>
                </span>
                <span className="rounded bg-background px-2 py-1">
                  {t("predict.stationSum")}:{" "}
                  <span className="font-mono font-semibold text-accent">
                    {formatMs(g.station_total_ms)}
                  </span>
                </span>
                <span className="rounded bg-background px-2 py-1">
                  {t("predict.roxzoneBudget")}:{" "}
                  <span className="font-mono font-semibold">
                    {formatMs(g.roxzone_total_ms)}
                  </span>
                </span>
              </div>

              {Array.isArray(g.stations) && g.stations.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {g.stations.map((s) => (
                    <span
                      key={s.key}
                      className="flex items-center justify-between rounded bg-background px-2 py-1 text-xs"
                    >
                      <span className="truncate text-muted">
                        {t(`hstation.${s.key}` as Parameters<typeof t>[0])}
                      </span>
                      <span className="ml-2 shrink-0 font-mono font-semibold">
                        {formatMs(s.targetMs)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
