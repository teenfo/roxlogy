import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatMs, todayISOIn } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import { DOUBLES_DIVISIONS } from "@/lib/divisions";
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

/** 내 대회일정 상세 — 목표·파트너·같이 나가는 크루원을 한 곳에.
 *  공식 대회 페이지(/events/[id])는 대회 자체의 정보라 별개다. */
export default async function RacePlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag, tz } = await getT();

  const { data } = await supabase.rpc("my_race_plan", { p_plan: id });
  const plan = ((data ?? []) as PlanRow[])[0];
  // 내 계획도 아니고 초대받은 것도 아니면 존재 여부를 흘리지 않는다
  if (!plan) notFound();

  const { data: mateRows } = plan.race_event_id
    ? await supabase.rpc("race_event_crewmates", {
        p_event: plan.race_event_id,
      })
    : { data: [] as Crewmate[] };
  // 나와 파트너는 파트너 카드에 이미 있다
  const partnerIds = new Set(plan.partners.map((p) => p.user_id));
  const mates = ((mateRows ?? []) as Crewmate[]).filter(
    (m) => !partnerIds.has(m.user_id),
  );

  const dday = Math.round(
    (Date.parse(plan.race_date) - Date.parse(todayISOIn(tz))) / 86400000,
  );
  const dateLabel = new Date(`${plan.race_date}T00:00:00`).toLocaleDateString(
    tag,
    { year: "numeric", month: "long", day: "numeric", weekday: "long" },
  );
  const isDoubles =
    !!plan.division &&
    (DOUBLES_DIVISIONS as readonly string[]).includes(plan.division);
  const isOwner = plan.role === "owner";

  const splits = [
    { key: "landing.m.run", ms: plan.goal_run_ms },
    { key: "landing.m.station", ms: plan.goal_station_ms },
    { key: "landing.m.roxzone", ms: plan.goal_roxzone_ms },
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-[860px] flex-col gap-3.5">
      <Link
        href="/schedule"
        className="w-fit text-[13px] text-muted transition-colors hover:text-foreground"
      >
        ← {t("meta.schedule")}
      </Link>

      {/* 헤더 */}
      <Card highlight className="px-6 py-5 max-md:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-line-accent px-2 py-0.5 text-[10px] font-extrabold tracking-[0.06em] text-accent">
            MY RACE
          </span>
          {plan.division && (
            <span className="rounded-md bg-label-bg px-2 py-0.5 text-[11px] font-bold text-label">
              {dictLabel(t, `division.${plan.division}`, plan.division)}
            </span>
          )}
          {plan.bib && (
            <span className="tabular rounded-md bg-info-bg px-2 py-0.5 text-[11px] font-bold text-info">
              BIB {plan.bib}
            </span>
          )}
          {!isOwner && (
            <span className="rounded-md bg-line px-2 py-0.5 text-[11px] font-bold text-muted">
              {t("race.byOwner", { name: plan.owner_name })}
            </span>
          )}
        </div>

        <h1 className="mt-2.5 text-[26px] font-extrabold tracking-tight [word-break:keep-all] max-md:text-xl">
          {plan.title}
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/80">
          <span>{dateLabel}</span>
          {dday >= 0 && (
            <span className="tabular rounded-md bg-line px-2 py-0.5 text-xs font-bold">
              D-{dday}
            </span>
          )}
        </p>
        {plan.note && (
          <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted">
            {plan.note}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {plan.race_event_id && (
            <Link
              href={`/events/${plan.race_event_id}`}
              className="flex h-9 items-center rounded-lg border border-line-strong bg-control px-4 text-[13px] font-semibold transition-colors hover:border-[#555]"
            >
              {t("race.officialEvent")} →
            </Link>
          )}
          {isOwner && (
            <>
              <Link
                href={`/predict?event=${encodeURIComponent(plan.title)}&date=${plan.race_date}`}
                className="flex h-9 items-center rounded-lg bg-accent px-4 text-[13px] font-extrabold text-background transition hover:brightness-110"
              >
                {plan.goal_target_ms == null
                  ? t("events.setGoal")
                  : t("race.goalEdit")}
              </Link>
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
            </>
          )}
        </div>
      </Card>

      {/* 목표 */}
      {plan.goal_target_ms != null && (
        <Card className="px-6 py-5 max-md:px-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-extrabold">{t("race.goalTitle")}</h2>
            <span className="tabular text-2xl font-extrabold text-accent">
              {formatMs(plan.goal_target_ms)}
            </span>
          </div>
          {splits.some((s) => s.ms != null) && (
            <ul className="mt-3 grid grid-cols-3 gap-2.5">
              {splits.map((s) => (
                <li
                  key={s.key}
                  className="rounded-[10px] border border-line bg-page px-3.5 py-3"
                >
                  <p className="text-[11px] text-muted">{t(s.key)}</p>
                  <p className="tabular mt-0.5 text-[17px] font-extrabold">
                    {s.ms == null ? "—" : formatMs(s.ms)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* 파트너 — 더블·릴레이만 */}
      {isDoubles && (
        <Card className="px-6 py-5 max-md:px-4">
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
        <Card className="px-6 py-5 max-md:px-4">
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
