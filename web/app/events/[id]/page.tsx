import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { eventDateNote, eventPlace } from "@/lib/event-display";
import { formatMs } from "@/lib/format";
import {
  getEventLiveDetail,
  percentileWithin,
} from "@/lib/hyrox-event-detail";
import { CrewHeader } from "@/components/crew-header";
import { Avatar } from "@/components/ui/crew-ui";

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

type MyGoal = { target_total_ms: number; event_name: string | null };

type Crewmate = {
  user_id: string;
  display_name: string;
  crew_slug: string;
  crew_name: string;
  division: string | null;
  race_date: string;
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ t, tag, locale }, user] = await Promise.all([getT(), getCachedUser()]);

  const { data: ev } = await supabase
    .from("race_events")
    .select(
      "id, name, city, api_city, country, region, venue, start_date, end_date, date_note, season, official_url",
    )
    .eq("id", id)
    .maybeSingle();
  if (!ev) notFound();

  // 라이브 상세 (토큰 미설정/미개최 대회면 null) + 내 목표 + 같이 나가는 크루원
  const [live, goal, { data: mateRows }] = await Promise.all([
    getEventLiveDetail(ev),
    user
      ? (async () => {
          // 이 대회로 등록한 내 대회일정에 목표가 붙어 있으면 그게 정답이다 —
          // 이름 매칭은 대회명을 손으로 고치면 바로 어긋난다.
          const { data: linked } = await supabase
            .from("race_plans")
            .select("goal:goal_plans ( target_total_ms, event_name )")
            .eq("user_id", user.id)
            .eq("race_event_id", id)
            .not("goal_plan_id", "is", null)
            .order("race_date")
            .limit(1)
            .maybeSingle();
          const g = (linked as { goal: MyGoal | MyGoal[] | null } | null)?.goal;
          const one = Array.isArray(g) ? (g[0] ?? null) : (g ?? null);
          if (one) return one;

          const { data } = await supabase
            .from("goal_plans")
            .select("target_total_ms, event_name")
            .order("created_at", { ascending: false })
            .limit(10);
          const gs = (data ?? []) as MyGoal[];
          // 이 대회를 목표로 지정한 것 우선, 없으면 최근 목표
          return gs.find((x) => x.event_name?.startsWith(ev.name)) ?? gs[0] ?? null;
        })()
      : Promise.resolve(null),
    // 같은 대회에 나가는 크루원 — 나와 같은 크루인 사람만 내려온다(RPC 가 게이트)
    user
      ? supabase.rpc("race_event_crewmates", { p_event: id })
      : Promise.resolve({ data: [] as Crewmate[] }),
  ]);
  const mates = (mateRows ?? []) as Crewmate[];

  // 이 대회로 등록해 둔 내 대회일정 — 있으면 그 상세로 건너갈 수 있게 한다
  const { data: myPlanRow } = user
    ? await supabase
        .from("race_plans")
        .select("id")
        .eq("user_id", user.id)
        .eq("race_event_id", id)
        .order("race_date")
        .limit(1)
        .maybeSingle()
    : { data: null };
  const myPlanId = (myPlanRow as { id: string } | null)?.id ?? null;

  const dateRange = ev.start_date
    ? `${ev.start_date}${ev.end_date && ev.end_date !== ev.start_date ? ` ~ ${ev.end_date}` : ""}`
    : (eventDateNote(t, ev, tag) ?? t("events.tbd"));

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
            {eventPlace(t, ev, locale)}
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
          {myPlanId && (
            <Link
              href={`/schedule/race/${myPlanId}?from=${encodeURIComponent(`/events/${id}`)}`}
              className="rounded-md border border-line-accent bg-highlight px-3 py-1.5 text-xs font-bold text-accent hover:brightness-125"
            >
              {t("race.myPlan")} →
            </Link>
          )}
          <Link
            href={`/predict?event=${encodeURIComponent(ev.name)}${ev.start_date ? `&date=${ev.start_date}` : ""}`}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110"
          >
            {t("events.setGoal")}
          </Link>
        </div>

        {/* 같이 나가는 크루원 — 로그인 + 같은 크루일 때만 내려온다 */}
        {mates.length > 0 && (
          <section className="mt-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {t("events.crewmates")}
              </h2>
              <span className="text-xs text-muted">
                {t("events.crewmatesN", { n: mates.length })}
              </span>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {mates.map((m) => (
                <li key={m.user_id}>
                  <Link
                    href={`/u/${m.user_id}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 transition-colors hover:border-line-strong hover:bg-card-hover"
                  >
                    <Avatar name={m.display_name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">
                        {m.display_name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {m.crew_name}
                        {m.division
                          ? ` · ${m.division.replace("_", " ").toUpperCase()}`
                          : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

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
                        <p className="text-xs text-muted">{t("events.median")}</p>
                        <p className="font-mono text-sm font-bold">
                          {formatMs(d.medianMs)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">
                          {t("events.midRange")}
                        </p>
                        <p className="font-mono text-sm">
                          {formatMs(d.p25Ms)}–{formatMs(d.p75Ms)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">{t("events.top10")}</p>
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
            <p className="mt-2 text-xs text-muted">{t("events.statsNote")}</p>
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
