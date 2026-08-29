import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  CrewMeetupForm,
  CrewRacePlanForm,
  type MyRacePlan,
} from "@/components/crew-schedule-forms";

type CalRow = {
  kind: "meetup" | "race" | "program";
  on_date: string;
  starts_at: string | null;
  ref_id: string;
  title: string;
  subtitle: string;
  member_id: string | null;
  member_name: string | null;
  going_count: number | null;
  my_status: string | null;
  result_ms: number | null;
  members_only: boolean;
};

/** ms → h:mm:ss / m:ss */
function fmtResult(ms: number): string {
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** YYYY-MM 문자열 → [해당 월 1일, 말일] */
function monthRange(m: string): [string, string] {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const mm = String(mo).padStart(2, "0");
  return [`${m}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`];
}

function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function CrewSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const { slug } = await params;
  const { m } = await searchParams;
  const now = new Date();
  const month =
    m && /^\d{4}-\d{2}$/.test(m)
      ? m
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [from, to] = monthRange(month);

  const [crew, user, { t, tag }] = await Promise.all([
    getCrew(slug),
    getCachedUser(),
    getT(),
  ]);
  if (!crew) notFound();

  const supabase = await createClient();
  const isMember = crew.my_status === "active";
  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";

  const [{ data: rows }, { data: myPlans }] = await Promise.all([
    supabase.rpc("crew_calendar", { p_slug: slug, p_from: from, p_to: to }),
    isMember
      ? supabase
          .from("race_plans")
          .select("id, title, race_date, division, bib, note, goal_plan_id")
          .order("race_date")
      : Promise.resolve({ data: [] as MyRacePlan[] }),
  ]);
  const cal = (rows ?? []) as CalRow[];

  // 날짜별 그룹
  const byDate = new Map<string, CalRow[]>();
  for (const r of cal) {
    const arr = byDate.get(r.on_date) ?? [];
    arr.push(r);
    byDate.set(r.on_date, arr);
  }
  const dates = [...byDate.keys()].sort();

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(tag, {
    year: "numeric",
    month: "long",
  });
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(tag, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(tag, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Seoul",
    });
  const todayIso = new Date().toISOString().slice(0, 10);

  const kindBadge = {
    meetup: ["bg-accent/15 text-accent", t("crew.schedKindMeetup")],
    race: ["bg-track/15 text-track", t("crew.schedKindRace")],
    program: ["bg-background text-muted", t("crew.schedKindProgram")],
  } as const;

  return (
    <main>
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between">
        <Link
          href={`/crews/${slug}/schedule?m=${shiftMonth(month, -1)}`}
          className="text-sm text-accent hover:underline"
        >
          ←
        </Link>
        <span className="text-sm font-bold">{monthLabel}</span>
        <Link
          href={`/crews/${slug}/schedule?m=${shiftMonth(month, 1)}`}
          className="text-sm text-accent hover:underline"
        >
          →
        </Link>
      </div>

      {/* 등록 액션 */}
      {(isStaff || isMember) && (
        <div className="mt-4 flex flex-col gap-3">
          {isStaff && <CrewMeetupForm crewId={crew.id} />}
          {isMember && (
            <CrewRacePlanForm myPlans={(myPlans ?? []) as MyRacePlan[]} />
          )}
        </div>
      )}

      {/* 일정 리스트 */}
      {!dates.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("crew.schedEmpty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {dates.map((d) => (
            <li
              key={d}
              className={`rounded-md px-4 py-3 ${
                d === todayIso
                  ? "bg-accent/10 ring-1 ring-accent/40"
                  : "bg-surface"
              }`}
            >
              <p className="text-xs font-semibold text-muted">{dayLabel(d)}</p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {byDate.get(d)!.map((r, i) => {
                  const [badgeCls, badgeLabel] = kindBadge[r.kind];
                  const inner = (
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeCls}`}
                      >
                        {badgeLabel}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium">
                        {r.title}
                      </span>
                      {r.members_only && (
                        <span className="shrink-0 rounded-full bg-track/15 px-2 py-0.5 text-[10px] font-bold text-track">
                          {t("crew.fullOnly")}
                        </span>
                      )}
                      {r.kind === "meetup" && r.starts_at && (
                        <span className="text-xs text-muted">
                          {timeLabel(r.starts_at)}
                        </span>
                      )}
                      {r.kind === "race" && r.starts_at && (
                        <span className="text-xs text-muted">
                          🕐 {timeLabel(r.starts_at)}
                        </span>
                      )}
                      {r.kind === "race" && r.member_name && (
                        <span className="text-xs text-track">{r.member_name}</span>
                      )}
                      {r.kind === "race" && r.result_ms != null && (
                        <span className="rounded-full bg-track/15 px-2 py-0.5 font-mono text-xs font-bold text-track">
                          🏁 {fmtResult(r.result_ms)}
                        </span>
                      )}
                      {r.subtitle && (
                        <span className="truncate text-xs text-muted">
                          {r.subtitle}
                        </span>
                      )}
                      {r.kind === "meetup" && (
                        <span className="ml-auto shrink-0 text-xs text-muted">
                          ✓ {r.going_count ?? 0}
                          {r.my_status === "going" && (
                            <span className="ml-1 text-accent">
                              {t("crew.rsvpGoing")}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  );
                  return (
                    <li key={`${r.kind}-${r.ref_id}-${i}`}>
                      {r.kind === "meetup" ? (
                        <Link
                          href={`/crews/${slug}/schedule/${r.ref_id}`}
                          className="block rounded-md bg-background px-3 py-2 hover:ring-1 hover:ring-accent/40"
                        >
                          {inner}
                        </Link>
                      ) : r.kind === "program" ? (
                        <Link
                          href={`/programs/${r.ref_id}`}
                          className="block rounded-md bg-background px-3 py-2 hover:ring-1 hover:ring-muted/40"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="rounded-md bg-background px-3 py-2">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {!user && (
        <p className="mt-4 text-xs text-muted">{t("crew.membersOnlyRsvp")}</p>
      )}
    </main>
  );
}
