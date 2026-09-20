import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatMs, todayISOIn } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import { DOUBLES_DIVISIONS } from "@/lib/divisions";
import { eventPlace } from "@/lib/event-display";
import { safeNext } from "@/lib/site-url";
import { RacePartnerBox, type PlanPartner } from "@/components/race-partner-box";
import { RacePlanEditor } from "@/components/crew-schedule-forms";
import { Back, Chip, Go, PageHead, Panel, RecordRow } from "@/components/rox/ui";

type PlanRow = {
  id: string;
  title: string;
  race_date: string;
  division: string | null;
  bib: string | null;
  note: string | null;
  goal_plan_id: string | null;
  race_event_id: string | null;
  role: "owner" | "partner";
  my_status: "pending" | "accepted" | "declined" | null;
  owner_name: string;
  partners: PlanPartner[];
  goal_target_ms: number | null;
  goal_run_ms: number | null;
  goal_station_ms: number | null;
  goal_roxzone_ms: number | null;
};

type Crewmate = {
  user_id: string;
  display_name: string;
  crew_name: string;
  division: string | null;
};

type EventRow = {
  name: string;
  city: string | null;
  city_en: string | null;
  country: string | null;
  country_code: string | null;
  venue: string | null;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_race_plan", { p_plan: id });
  const plan = ((data ?? []) as PlanRow[])[0];
  return { title: plan ? `${plan.title} — Roxlogy` : "Roxlogy" };
}

/**
 * 내 레이스 계획 — 시안 completion-details.tsx 의 RacePlan 그대로 (PORT_PLAN §3-c):
 * Back · PageHead(편집) · .rx-plan-hero · two-col[목표 구간 배분 · 파트너 · 메모 | 대회 · 크루원].
 * 편집·파트너 초대는 우리 모달(RacePlanEditor·RacePartnerBox)이다.
 */
export default async function RacePlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  // 같은 목록이 내 일정과 크루 일정 두 곳에 있어서, 들어온 곳을 링크가 실어 준다.
  const backHref = safeNext(from) ?? "/schedule";
  const supabase = await createClient();
  const { t, tag, tz, locale } = await getT();

  const { data } = await supabase.rpc("my_race_plan", { p_plan: id });
  const plan = ((data ?? []) as PlanRow[])[0];
  // 내 계획도 아니고 초대받은 것도 아니면 존재 여부를 흘리지 않는다
  if (!plan) notFound();

  const [{ data: mateRows }, { data: evRow }] = await Promise.all([
    plan.race_event_id
      ? supabase.rpc("race_event_crewmates", { p_event: plan.race_event_id })
      : Promise.resolve({ data: [] as Crewmate[] }),
    plan.race_event_id
      ? supabase
          .from("race_events")
          .select("name, city, city_en, country, country_code, venue")
          .eq("id", plan.race_event_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  // 나와 파트너는 파트너 카드에 이미 있다
  const partnerIds = new Set(plan.partners.map((p) => p.user_id));
  const mates = ((mateRows ?? []) as Crewmate[]).filter(
    (m) => !partnerIds.has(m.user_id),
  );
  const ev = evRow as EventRow | null;
  const place = ev
    ? [eventPlace(t, ev, locale), ev.venue].filter(Boolean).join(" · ")
    : null;

  const startsAt = new Date(`${plan.race_date}T00:00:00`);
  const when = startsAt.toLocaleDateString(tag, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const dday = Math.round(
    (Date.parse(plan.race_date) - Date.parse(todayISOIn(tz))) / 86400000,
  );

  const isDoubles =
    !!plan.division &&
    (DOUBLES_DIVISIONS as readonly string[]).includes(plan.division);
  const isOwner = plan.role === "owner";
  const divisionLabel = plan.division
    ? dictLabel(t, `division.${plan.division}`, plan.division)
    : null;
  const backLabel = backHref.startsWith("/crews/")
    ? `${t("nav.crews")} ${t("nav.schedule")}`
    : backHref.startsWith("/events/")
      ? t("nav.events")
      : t("nav.schedule");

  return (
    <div className="rx-completion">
      <Back href={backHref} label={backLabel} />
      <PageHead
        title={t("race.planTitle" as Parameters<typeof t>[0]) === "race.planTitle" ? plan.title : plan.title}
        description={t("race.planIntro")}
        action={
          isOwner ? (
            <RacePlanEditor
              backHref={backHref}
              plan={{
                id: plan.id,
                title: plan.title,
                race_date: plan.race_date,
                division: plan.division,
                bib: plan.bib,
                note: plan.note,
              }}
            />
          ) : undefined
        }
      />
      <section className="rx-plan-hero">
        <span className="rx-kicker">
          MY RACE{dday >= 0 ? ` · D–${dday}` : ` · ${t("race.past")}`}
        </span>
        <h2>{plan.title}</h2>
        <div>
          <span>
            <CalendarDays size={18} />
            {when}
          </span>
          {divisionLabel && (
            <span>
              {t("dash.division")} · {divisionLabel}
            </span>
          )}
          <span>BIB · {plan.bib || "—"}</span>
        </div>
        <strong>{plan.goal_target_ms == null ? "—" : formatMs(plan.goal_target_ms)}</strong>
        <small>
          {t("race.goalTitle")} · {t("race.owner")}: {plan.owner_name}
        </small>
      </section>
      <div className="rx-two-col">
        <div>
          <Panel title={t("race.goalBreakdown")}>
            {plan.goal_target_ms == null ? (
              <p className="rx-hint">{t("race.goalNone")}</p>
            ) : (
              <div className="rx-detail-stats">
                {[
                  [t("landing.m.run"), plan.goal_run_ms],
                  [t("landing.m.station"), plan.goal_station_ms],
                  [t("landing.m.roxzone"), plan.goal_roxzone_ms],
                ].map(([label, ms]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <strong>{ms == null ? "—" : formatMs(ms as number)}</strong>
                  </div>
                ))}
              </div>
            )}
            {isOwner && (
              <Go
                href={`/predict?event=${encodeURIComponent(plan.title)}&date=${plan.race_date}`}
              >
                {plan.goal_target_ms == null ? t("events.setGoal") : t("race.goalEdit")}
              </Go>
            )}
          </Panel>
          {isDoubles && (
            <Panel title={t("race.partners")}>
              <p className="rx-hint">{t("race.partnersDesc")}</p>
              <div>
                <RacePartnerBox
                  planId={plan.id}
                  partners={plan.partners}
                  isOwner={isOwner}
                  myStatus={plan.my_status}
                />
              </div>
            </Panel>
          )}
          <Panel title={t("race.noteTitle")}>
            <p style={{ whiteSpace: "pre-wrap" }}>{plan.note || "—"}</p>
          </Panel>
        </div>
        <aside>
          <Panel title={t("nav.events")}>
            <h3>{ev?.name ?? plan.title}</h3>
            <p>
              {when}
              {place ? ` · ${place}` : ""}
            </p>
            {plan.race_event_id ? (
              <Go href={`/events/${plan.race_event_id}`}>{t("race.officialEvent")}</Go>
            ) : (
              <Go href="/events">{t("nav.events")}</Go>
            )}
          </Panel>
          <Panel title={t("events.crewmates")}>
            {mates.length ? (
              mates.map((m) => (
                <RecordRow
                  key={m.user_id}
                  href={`/u/${m.user_id}`}
                  title={m.display_name}
                  note={[
                    m.crew_name,
                    m.division ? dictLabel(t, `division.${m.division}`, m.division) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))
            ) : (
              <p className="rx-hint">
                <Chip>—</Chip> <Link href="/crews">{t("nav.crews")}</Link>
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
