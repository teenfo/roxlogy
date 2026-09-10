import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatMs, todayISOIn } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import { DOUBLES_DIVISIONS } from "@/lib/divisions";
import { eventPlace } from "@/lib/event-display";
import { Avatar, Card } from "@/components/ui/crew-ui";
import { RacePartnerBox, type PlanPartner } from "@/components/race-partner-box";
import { RacePlanEditor } from "@/components/crew-schedule-forms";

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
 * 내 대회일정 상세 — 크루 모임 상세와 같은 구성(날짜 블록 히어로 → 지표 행 →
 * 카드들)으로 맞춘다. 일정에서 들어오는 두 화면이 서로 다르게 생기면 같은
 * 목록에서 나온 것처럼 보이지 않는다.
 */
export default async function RacePlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const dpart = (opt: Intl.DateTimeFormatOptions) =>
    startsAt.toLocaleDateString(tag, opt);
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
  const accepted = plan.partners.filter((p) => p.status === "accepted").length;

  const badges: { label: string; cls: string }[] = [
    { label: "MY RACE", cls: "border border-line-accent text-accent" },
  ];
  if (plan.division)
    badges.push({
      label: dictLabel(t, `division.${plan.division}`, plan.division),
      cls: "bg-label-bg text-label",
    });
  if (plan.bib)
    badges.push({ label: `BIB ${plan.bib}`, cls: "bg-info-bg text-info" });
  if (!isOwner)
    badges.push({
      label: t("race.byOwner", { name: plan.owner_name }),
      cls: "bg-line text-muted",
    });
  if (dday < 0)
    badges.push({ label: t("race.past"), cls: "bg-line text-muted" });

  const splits = [
    { key: "landing.m.run", ms: plan.goal_run_ms },
    { key: "landing.m.station", ms: plan.goal_station_ms },
    { key: "landing.m.roxzone", ms: plan.goal_roxzone_ms },
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-[860px] flex-col gap-3.5">
      {/* 히어로 — 크루 모임 상세와 같은 구성 */}
      <section className="overflow-hidden rounded-2xl border border-line-mid bg-card">
        <div className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-start gap-5 px-6 py-[22px] max-md:grid-cols-[64px_minmax(0,1fr)] max-md:gap-4 max-md:px-4">
          <div className="flex flex-col items-center border-r border-line-mid pr-4">
            <span className="text-xs font-semibold text-muted">
              {dpart({ month: "short" })}
            </span>
            <span className="tabular text-[40px] font-extrabold leading-none max-md:text-[32px]">
              {dpart({ day: "numeric" })}
            </span>
            <span className="text-[13px] font-semibold text-muted">
              {dpart({ weekday: "short" })}
            </span>
          </div>

          <div className="flex min-w-0 flex-col gap-2.5">
            <span className="flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <span
                  key={b.label}
                  className={`rounded-[5px] px-2 py-[3px] text-[11px] font-bold ${b.cls}`}
                >
                  {b.label}
                </span>
              ))}
            </span>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em] [word-break:keep-all] max-md:text-[22px]">
              {plan.title}
            </h1>
            <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-foreground/80">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="text-muted">
                  ◷
                </span>
                {when}
              </span>
              {place && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="text-muted">
                    ◎
                  </span>
                  {place}
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 max-md:col-span-2">
            <Link
              href="/schedule"
              className="flex h-[34px] shrink-0 items-center rounded-lg border border-line-strong bg-control px-3.5 text-[13px] font-semibold transition-colors hover:border-[#555]"
            >
              ← {t("meta.schedule")}
            </Link>
            {plan.race_event_id && (
              <Link
                href={`/events/${plan.race_event_id}`}
                className="flex h-[34px] shrink-0 items-center rounded-lg border border-line-strong bg-control px-3.5 text-[13px] font-semibold transition-colors hover:border-[#555]"
              >
                {t("race.officialEvent")}
              </Link>
            )}
            {isOwner && (
              <RacePlanEditor
                plan={{
                  id: plan.id,
                  title: plan.title,
                  race_date: plan.race_date,
                  division: plan.division,
                  bib: plan.bib,
                  note: plan.note,
                }}
              />
            )}
          </div>
        </div>

        {/* 지표 행 */}
        <div className="grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-3">
          <div className="px-6 py-3.5 max-md:px-4">
            <p className="text-xs text-muted">D-day</p>
            <p className="tabular mt-0.5 text-[22px] font-extrabold max-md:text-lg">
              {dday >= 0 ? `D-${dday}` : t("race.past")}
            </p>
          </div>
          <div className="px-6 py-3.5 max-md:px-4">
            <p className="text-xs text-muted">{t("race.goalTitle")}</p>
            <p className="tabular mt-0.5 text-[22px] font-extrabold text-accent max-md:text-lg">
              {plan.goal_target_ms == null ? "—" : formatMs(plan.goal_target_ms)}
            </p>
          </div>
          {isDoubles && (
            <div className="px-6 py-3.5 max-md:px-4 max-sm:col-span-2 max-sm:border-t max-sm:border-line">
              <p className="text-xs text-muted">{t("race.partners")}</p>
              <p className="tabular mt-0.5 text-[22px] font-extrabold max-md:text-lg">
                {accepted}
                <span className="text-sm font-bold text-muted">
                  {" / "}
                  {plan.partners.length}
                </span>
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 메모 + 목표 — 모임 상세의 "소개 + 내 참석" 2열과 같은 자리 */}
      <div
        className={`grid items-start gap-3.5 ${
          plan.note ? "md:grid-cols-[minmax(0,1fr)_300px]" : ""
        }`}
      >
        {plan.note && (
          <Card className="px-[22px] py-5 max-md:order-2 max-md:px-4">
            <h2 className="text-[15px] font-extrabold">{t("race.noteTitle")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.7] text-foreground/85 [word-break:keep-all]">
              {plan.note}
            </p>
          </Card>
        )}

        <Card className="flex flex-col gap-3 px-5 py-[18px] max-md:order-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-extrabold">{t("race.goalTitle")}</h2>
            {isOwner && (
              <Link
                href={`/predict?event=${encodeURIComponent(plan.title)}&date=${plan.race_date}`}
                className="ml-auto text-xs font-bold text-accent hover:underline"
              >
                {plan.goal_target_ms == null
                  ? t("events.setGoal")
                  : t("race.goalEdit")}
              </Link>
            )}
          </div>
          {plan.goal_target_ms == null ? (
            <p className="text-[13px] text-muted [word-break:keep-all]">
              {t("race.goalNone")}
            </p>
          ) : (
            <>
              <p className="tabular text-3xl font-extrabold text-accent">
                {formatMs(plan.goal_target_ms)}
              </p>
              {splits.some((s) => s.ms != null) && (
                <ul className="flex flex-col gap-2 border-t border-line pt-3">
                  {splits.map((s) => (
                    <li
                      key={s.key}
                      className="flex items-center justify-between text-[13px]"
                    >
                      <span className="text-muted">{t(s.key)}</span>
                      <span className="tabular font-bold">
                        {s.ms == null ? "—" : formatMs(s.ms)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      </div>

      {/* 파트너 — 더블·릴레이만 */}
      {isDoubles && (
        <Card className="px-[22px] py-5 max-md:px-4">
          <h2 className="text-[15px] font-extrabold">{t("race.partners")}</h2>
          <p className="mt-0.5 text-xs text-muted [word-break:keep-all]">
            {t("race.partnersDesc")}
          </p>
          <div className="mt-3">
            <RacePartnerBox
              planId={plan.id}
              partners={plan.partners}
              isOwner={isOwner}
              myStatus={plan.my_status}
            />
          </div>
        </Card>
      )}

      {/* 같이 나가는 크루원 */}
      {mates.length > 0 && (
        <Card className="px-[22px] py-5 max-md:px-4">
          <h2 className="text-[15px] font-extrabold">{t("events.crewmates")}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {mates.map((m) => (
              <li key={m.user_id}>
                <Link
                  href={`/u/${m.user_id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-page px-4 py-2.5 transition-colors hover:border-line-strong"
                >
                  <Avatar name={m.display_name} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">
                      {m.display_name}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {m.crew_name}
                      {m.division
                        ? ` · ${dictLabel(t, `division.${m.division}`, m.division)}`
                        : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
