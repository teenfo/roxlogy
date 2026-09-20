import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { eventDateNote, eventPlace } from "@/lib/event-display";
import { formatMs } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import { getEventLiveDetail, percentileWithin } from "@/lib/hyrox-event-detail";
import { Shell } from "@/components/rox/shell";
import { Person } from "@/components/rox/person";
import { Button } from "@/components/ui/button";
import { Back, Chip, DataTable, Empty, Go, Hint, Panel } from "@/components/rox/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("race_events").select("name, city").eq("id", id).maybeSingle();
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

/**
 * 대회 상세 — 시안 racing.tsx Events({id}) 그대로 (PORT_PLAN §3-d):
 * Back · .rx-event-hero(킥커 · 도시 · 대회명·일정 · Chip 국가 + 장소) · two-col[ Panel "레이스 준비"(DataTable 항목/내용 ·
 * Go 목표 · 공식 일정 · Hint) | Panel "같이 출전하는 크루"(.rx-person 행 · Go) ]. 디비전 결과(실측)는 우리 것이라 Panel + DataTable(§4).
 */
export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ t, tag, locale }, user] = await Promise.all([getT(), getCachedUser()]);

  const { data: ev } = await supabase
    .from("race_events")
    .select("id, name, city, city_en, api_city, country, country_code, region, venue, start_date, end_date, date_note, season, official_url")
    .eq("id", id)
    .maybeSingle();
  if (!ev) notFound();

  // 라이브 상세 (토큰 미설정/미개최 대회면 null) + 내 목표 + 같이 나가는 크루원
  const [live, goal, { data: mateRows }, { data: myPlanRow }] = await Promise.all([
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

          const { data } = await supabase.from("goal_plans").select("target_total_ms, event_name").order("created_at", { ascending: false }).limit(10);
          const gs = (data ?? []) as MyGoal[];
          // 이 대회를 목표로 지정한 것 우선, 없으면 최근 목표
          return gs.find((x) => x.event_name?.startsWith(ev.name)) ?? gs[0] ?? null;
        })()
      : Promise.resolve(null),
    // 같은 대회에 나가는 크루원 — 나와 같은 크루인 사람만 내려온다(RPC 가 게이트)
    user ? supabase.rpc("race_event_crewmates", { p_event: id }) : Promise.resolve({ data: [] as Crewmate[] }),
    // 이 대회로 등록해 둔 내 대회일정 — 있으면 그 상세로 건너갈 수 있게 한다.
    user ? supabase.from("race_plans").select("id").eq("user_id", user.id).eq("race_event_id", id).order("race_date").limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const mates = (mateRows ?? []) as Crewmate[];
  const myPlanId = (myPlanRow as { id: string } | null)?.id ?? null;

  const dateRange = ev.start_date ? `${ev.start_date}${ev.end_date && ev.end_date !== ev.start_date ? ` — ${ev.end_date}` : ""}` : (eventDateNote(t, ev, tag) ?? t("events.tbd"));
  const phase = live?.phase === "finished" ? t("events.phaseFinished") : live?.phase === "racing" ? t("events.phaseRacing") : live?.phase === "scheduled" ? t("events.phaseScheduled") : null;
  const place = eventPlace(t, ev, locale);
  const predictHref = `/predict?event=${encodeURIComponent(ev.name)}${ev.start_date ? `&date=${ev.start_date}` : ""}`;
  // 크루별로 묶는다 — 시안의 "같이 출전하는 크루" 는 크루 단위다
  const crews = new Map<string, { name: string; slug: string; mates: Crewmate[] }>();
  for (const m of mates) {
    const cur = crews.get(m.crew_slug) ?? { name: m.crew_name, slug: m.crew_slug, mates: [] };
    cur.mates.push(m);
    crews.set(m.crew_slug, cur);
  }

  return (
    <Shell loginNext={`/events/${ev.id}`}>
      <Back href="/events" label={t("nav.events")} />
      <div className="rx-event-hero">
        <span>{(ev.season ?? "").toUpperCase() || "YOUR NEXT STARTING LINE"}</span>
        <h1>{(ev.city_en ?? ev.city ?? ev.name).toUpperCase()}</h1>
        <p>
          {ev.name} · {dateRange}
        </p>
        <div>
          <Chip tone="yellow">{ev.country_code === "KR" ? t("events.koreaBadge") : place}</Chip>
          {phase && <Chip>{phase}</Chip>}
          <span>
            <MapPin size={16} />
            {[ev.venue, place].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>

      <div className="rx-two-col">
        <Panel title={t("events.goal")}>
          <DataTable
            headers={[t("crew.eventInfoHeader"), t("crew.eventInfoValue")]}
            rows={[
              [t("nav.events"), ev.name],
              [t("crew.colWhen"), dateRange],
              [t("crew.eventPlace"), [ev.venue, place].filter(Boolean).join(" · ")],
              [t("events.goal"), goal ? formatMs(goal.target_total_ms) : "—"],
            ]}
          />
          <div className="rx-actions">
            <Go href={predictHref} primary>
              {t("events.setGoal")}
            </Go>
            {myPlanId && <Go href={`/schedule/race/${myPlanId}?from=${encodeURIComponent(`/events/${id}`)}`}>{t("race.myPlan")}</Go>}
            {ev.official_url && (
              <Button asChild variant="outline">
                <a href={ev.official_url} target="_blank" rel="noreferrer noopener">
                  {t("events.official")} <ArrowUpRight size={16} />
                </a>
              </Button>
            )}
          </div>
          <Hint>
            {t("events.disclaimer.before")}
            <a href="https://hyrox.com/find-my-race/" target="_blank" rel="noopener noreferrer">
              {t("events.disclaimer.link")}
            </a>
            {t("events.disclaimer.after")}
            {live?.phase !== "finished" && live?.resultsDueOn && ` · ${t("events.resultsDue", { date: live.resultsDueOn })}`}
          </Hint>
        </Panel>
        <Panel title={t("events.crewmates")}>
          {crews.size ? (
            [...crews.values()].map((c) => (
              <div key={c.slug}>
                <div className="rx-crew-mini">
                  <span className="rx-crew-mark">{c.name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <h3>{c.name}</h3>
                    <p>{t("events.crewmatesN", { n: c.mates.length })}</p>
                  </div>
                </div>
                {c.mates.map((m) => (
                  <Link key={m.user_id} href={`/u/${m.user_id}`} style={{ display: "block", marginBottom: 12 }}>
                    <Person name={m.display_name} note={m.division ? dictLabel(t, `division.${m.division}`, m.division) : undefined} />
                  </Link>
                ))}
                <Go href={`/crews/${c.slug}/schedule`}>
                  {t("crew.schedTab")} <ArrowRight size={16} />
                </Go>
              </div>
            ))
          ) : (
            <Empty title={t("events.crewmatesN", { n: 0 })} description={t("crew.guestNote")} action={<Go href="/crews">{t("nav.crews")}</Go>} />
          )}
        </Panel>
      </div>

      {/* 디비전 통계 (실측) — 시안에 없음(§4): Panel + DataTable */}
      {live && live.divisions.length > 0 ? (
        <Panel title={t("events.divStats")} action={<span className="rx-muted">{t("events.finishers", { n: live.totalFinishers.toLocaleString(tag) })}</span>}>
          <DataTable
            headers={[t("events.divisionCol"), t("events.finishersCol"), t("events.median"), t("events.midRange"), t("events.top10"), t("events.goal")]}
            rows={live.divisions.map((d) => {
              const myPct = goal?.target_total_ms != null ? percentileWithin(goal.target_total_ms, d) : null;
              return [
                <b key="l">{d.label}</b>,
                d.count.toLocaleString(tag),
                <span key="m" className="rx-number">
                  {formatMs(d.medianMs)}
                </span>,
                <span key="r" className="rx-number">
                  {formatMs(d.p25Ms)}–{formatMs(d.p75Ms)}
                </span>,
                <span key="t" className="rx-number">
                  {formatMs(d.p10Ms)}
                </span>,
                myPct != null ? <Chip key="g" tone="yellow">{t("events.myGoalPct", { time: formatMs(goal!.target_total_ms), pct: myPct })}</Chip> : <span key="g">—</span>,
              ];
            })}
          />
          <Hint>{t("events.statsNote")}</Hint>
        </Panel>
      ) : (
        <Panel title={t("events.divStats")}>
          <Empty title={t("events.noLive")} description={t("events.statsNote")} />
        </Panel>
      )}
    </Shell>
  );
}
