import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs } from "@/lib/format";
import {
  getEventLiveDetail,
  percentileWithin,
} from "@/lib/hyrox-event-detail";
import { CrewHeader } from "@/components/crew-header";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("race_events")
    .select("name, city")
    .eq("id", id)
    .maybeSingle();
  return { title: data ? `${data.name} — Roxlogy` : "Roxlogy" };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ t, tag }, user] = await Promise.all([getT(), getCachedUser()]);

  const { data: ev } = await supabase
    .from("race_events")
    .select(
      "id, name, city, api_city, country, region, venue, start_date, end_date, date_note, season, official_url",
    )
    .eq("id", id)
    .maybeSingle();
  if (!ev) notFound();

  // 라이브 상세 (토큰 미설정/미개최 대회면 null) + 내 목표
  const [live, goal] = await Promise.all([
    getEventLiveDetail(ev),
    user
      ? supabase
          .from("goal_plans")
          .select("target_total_ms, event_name")
          .order("created_at", { ascending: false })
          .limit(10)
          .then(({ data }) => {
            const gs = data ?? [];
            // 이 대회를 목표로 지정한 것 우선, 없으면 최근 목표
            return (
              gs.find((g) => g.event_name?.startsWith(ev.name)) ?? gs[0] ?? null
            );
          })
      : Promise.resolve(null),
  ]);

  const dateRange = ev.start_date
    ? `${ev.start_date}${ev.end_date && ev.end_date !== ev.start_date ? ` ~ ${ev.end_date}` : ""}`
    : (ev.date_note ?? t("events.tbd"));

  const phaseBadge =
    live?.phase === "finished"
      ? ["bg-track/15 text-track", t("events.phaseFinished")]
      : live?.phase === "racing"
        ? ["bg-accent/15 text-accent", t("events.phaseRacing")]
        : live?.phase === "scheduled"
          ? ["bg-surface text-muted", t("events.phaseScheduled")]
          : null;

  return (
    <>
      <CrewHeader loginNext={`/events/${ev.id}`} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <Link href="/events" className="text-sm text-muted hover:text-foreground">
          ← {t("nav.events")}
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight">{ev.name}</h1>
          {phaseBadge && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${phaseBadge[0]}`}
            >
              {phaseBadge[1]}
            </span>
          )}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {ev.city}, {ev.country}
          </span>
          <span className="font-medium text-track">{dateRange}</span>
          {ev.venue && <span>{ev.venue}</span>}
          {ev.season && <span>{ev.season}</span>}
        </p>
        {live?.phase !== "finished" && live?.resultsDueOn && (
          <p className="mt-1 text-xs text-muted">
            {t("events.resultsDue", { date: live.resultsDueOn })}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-3">
          {ev.official_url && (
            <a
              href={ev.official_url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md bg-surface px-3 py-1.5 text-xs font-semibold hover:text-accent"
            >
              {t("events.official")} ↗
            </a>
          )}
          <Link
            href={`/predict?event=${encodeURIComponent(ev.name)}${ev.start_date ? `&date=${ev.start_date}` : ""}`}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110"
          >
            {t("events.setGoal")}
          </Link>
        </div>

        {/* 디비전 통계 (실측) */}
        {live && live.divisions.length > 0 ? (
          <section className="mt-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">{t("events.divStats")}</h2>
              <span className="text-xs text-muted">
                {t("events.finishers", {
                  n: live.totalFinishers.toLocaleString(tag),
                })}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {live.divisions.map((d) => {
                const myPct =
                  goal?.target_total_ms != null
                    ? percentileWithin(goal.target_total_ms, d)
                    : null;
                return (
                  <div key={d.label} className="rounded-md bg-surface px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">{d.label}</p>
                      <p className="text-xs text-muted">
                        {t("events.finishers", { n: d.count.toLocaleString(tag) })}
                      </p>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-[11px] text-muted">{t("events.median")}</p>
                        <p className="font-mono text-sm font-bold">
                          {formatMs(d.medianMs)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted">
                          {t("events.midRange")}
                        </p>
                        <p className="font-mono text-sm">
                          {formatMs(d.p25Ms)}–{formatMs(d.p75Ms)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted">{t("events.top10")}</p>
                        <p className="font-mono text-sm text-track">
                          {formatMs(d.p10Ms)}
                        </p>
                      </div>
                    </div>
                    {myPct != null && (
                      <p className="mt-2 text-xs text-accent">
                        🎯 {t("events.myGoalPct", {
                          time: formatMs(goal!.target_total_ms),
                          pct: myPct,
                        })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted">{t("events.statsNote")}</p>
          </section>
        ) : (
          <p className="mt-8 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
            {t("events.noLive")}
          </p>
        )}
      </main>
    </>
  );
}
