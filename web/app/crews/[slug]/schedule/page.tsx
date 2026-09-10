import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { todayISOIn } from "@/lib/format";
import {
  CrewMeetupForm,
  CrewRsvpToggle,
  RacePlanForm,
  type MyRacePlan,
} from "@/components/crew-schedule-forms";
import { AvatarStack, Badge, Card } from "@/components/ui/crew-ui";

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
  fee_exempt: boolean;
  closed: boolean;
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

  const [crew, user, { t, tag, tz }] = await Promise.all([
    getCrew(slug),
    getCachedUser(),
    getT(),
  ]);
  if (!crew) notFound();

  // 기본 월·오늘 판정은 사용자 시간대 기준. 서버의 new Date() 는 UTC 라
  // 매월 1일·매일 아침(KST)에 한 칸씩 밀린다.
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : todayISOIn(tz).slice(0, 7);
  const [from, to] = monthRange(month);

  const supabase = await createClient();
  const isMember = crew.my_status === "active";
  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";

  const [{ data: rows }, { data: myPlans }] = await Promise.all([
    supabase.rpc("crew_calendar", { p_slug: slug, p_from: from, p_to: to }),
    isMember
      ? supabase
          .from("race_plans")
          .select("id, title, race_date, division, bib, note, goal_plan_id")
          .eq("user_id", user!.id)
          .order("race_date")
      : Promise.resolve({ data: [] as MyRacePlan[] }),
  ]);
  const cal = (rows ?? []) as CalRow[];

  // 참석자 아바타용 이름 — crew_calendar 는 인원수만 준다.
  // 별도 함수라 실패해도(구버전 DB) 아바타만 빠지고 목록은 그대로 나온다.
  const { data: nameRows } = await supabase.rpc("crew_month_going_names", {
    p_slug: slug,
    p_from: from,
    p_to: to,
  });
  const goingNames = new Map<string, string[]>(
    ((nameRows ?? []) as { event_id: string; names: string[] }[]).map((r) => [
      r.event_id,
      r.names ?? [],
    ]),
  );

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
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(tag, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });
  const todayIso = todayISOIn(tz);

  // 요약 + "다음 모임" 판정 — 오늘 이후 가장 이른 미종료 모임 하나
  const meetups = cal.filter((r) => r.kind === "meetup");
  const goingCount = meetups.filter((r) => r.my_status === "going").length;
  const nextMeetupId = meetups
    .filter((r) => !r.closed && r.on_date >= todayIso)
    .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))[0]
    ?.ref_id;

  const dayNum = (iso: string) => Number(iso.slice(8, 10));
  const weekday = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(tag, { weekday: "short" });
  const isSunday = (iso: string) =>
    new Date(`${iso}T00:00:00`).getDay() === 0;

  const kindLabel = {
    meetup: t("crew.schedKindMeetup"),
    race: t("crew.schedKindRace"),
    program: t("crew.schedKindProgram"),
  } as const;

  return (
    <main>
      {/* 툴바 — 좌: 내 대회일정 등록 · 중앙: 월 이동 · 우: 모임 등록.
          flex 가 아니라 grid 인 이유는, 한쪽 버튼이 없어도(스태프가 아니거나
          비회원) 월 바가 가운데에 그대로 있어야 하기 때문이다. */}
      <div className="grid items-start gap-3 max-md:grid-cols-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="min-w-0 max-md:order-2">
          {isMember && (
            <RacePlanForm myPlans={(myPlans ?? []) as MyRacePlan[]} />
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5 max-md:order-1 max-md:col-span-2">
          <div className="flex items-center rounded-[10px] border border-line-mid bg-control">
            <Link
              href={`/crews/${slug}/schedule?m=${shiftMonth(month, -1)}`}
              aria-label={t("crew.prevMonth")}
              className="flex h-9 w-9 items-center justify-center rounded-l-[10px] text-accent hover:bg-card-hover"
            >
              ‹
            </Link>
            <span className="tabular px-2 text-sm font-bold">{monthLabel}</span>
            <Link
              href={`/crews/${slug}/schedule?m=${shiftMonth(month, 1)}`}
              aria-label={t("crew.nextMonth")}
              className="flex h-9 w-9 items-center justify-center rounded-r-[10px] text-accent hover:bg-card-hover"
            >
              ›
            </Link>
          </div>
          <p className="text-[13px] text-muted">
            {t("crew.schedSummary", {
              meetups: meetups.length,
              going: goingCount,
            })}
          </p>
        </div>

        <div className="flex min-w-0 justify-end max-md:order-3">
          {isStaff && <CrewMeetupForm crewId={crew.id} />}
        </div>
      </div>

      {/* 일정 리스트 — 날짜 블록 + 본문 + 우측 참석 */}
      {!dates.length ? (
        <Card className="mt-6 px-4 py-10 text-center">
          <p className="text-sm text-muted">{t("crew.schedEmpty")}</p>
        </Card>
      ) : (
        <ul className="mt-6 flex flex-col gap-2.5">
          {dates.flatMap((d) =>
            byDate.get(d)!.map((r, i) => {
              const isNext = r.kind === "meetup" && r.ref_id === nextMeetupId;
              const done = r.kind === "meetup" && r.closed;
              const names = goingNames.get(r.ref_id) ?? [];
              const body = (
                <div
                  className={`grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border px-5 py-4 transition-colors ${
                    isNext
                      ? "border-line-accent bg-highlight"
                      : "border-line bg-card hover:bg-card-hover"
                  } ${done ? "opacity-55" : ""}`}
                >
                  {/* 날짜 블록 */}
                  <div className="border-r border-line-mid pr-3 text-center">
                    <p
                      className={`tabular text-[30px] font-extrabold leading-none ${
                        isNext
                          ? "text-accent"
                          : done
                            ? "text-muted"
                            : isSunday(d)
                              ? "text-sunday"
                              : ""
                      }`}
                    >
                      {dayNum(d)}
                    </p>
                    <p
                      className={`mt-1 text-[13px] font-semibold ${
                        isSunday(d) ? "text-sunday" : "text-muted"
                      }`}
                    >
                      {weekday(d)}
                    </p>
                  </div>

                  {/* 본문 */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[18px] font-bold">
                        {r.title}
                      </span>
                      {isNext && (
                        <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-extrabold text-background">
                          {t("crew.nextMeetup")}
                        </span>
                      )}
                      {r.kind !== "meetup" && (
                        <Badge tone={r.kind === "race" ? "info" : "neutral"}>
                          {kindLabel[r.kind]}
                        </Badge>
                      )}
                      {r.members_only && (
                        <Badge tone="label">{t("crew.fullOnly")}</Badge>
                      )}
                      {r.kind === "meetup" && r.fee_exempt && (
                        <Badge tone="info">{t("crew.feeExempt")}</Badge>
                      )}
                      {done && <Badge tone="neutral">{t("crew.closed")}</Badge>}
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
                      {r.starts_at && (
                        <>
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                          />
                          <span className="tabular font-semibold text-foreground/80">
                            {timeLabel(r.starts_at)}
                          </span>
                        </>
                      )}
                      {r.subtitle && <span className="truncate">{r.subtitle}</span>}
                      {r.kind === "race" && r.member_name && (
                        <span className="text-info">{r.member_name}</span>
                      )}
                      {r.kind === "race" && r.result_ms != null && (
                        <span className="tabular font-bold text-info">
                          🏁 {fmtResult(r.result_ms)}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* 우측 — 참석자 + 버튼 */}
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {r.kind === "meetup" && (
                      <>
                        {names.length > 0 && <AvatarStack names={names} />}
                        <span className="text-[12px] text-muted">
                          {r.going_count
                            ? t("crew.goingN", { n: r.going_count })
                            : t("crew.goingNone")}
                        </span>
                        {isMember && (
                          <CrewRsvpToggle
                            eventId={r.ref_id}
                            myStatus={r.my_status}
                            closed={r.closed}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
              const key = `${r.kind}-${r.ref_id}-${i}`;
              return (
                <li key={key}>
                  {r.kind === "meetup" ? (
                    <Link href={`/crews/${slug}/schedule/${r.ref_id}`}>
                      {body}
                    </Link>
                  ) : r.kind === "program" ? (
                    <Link href={`/programs/${r.ref_id}`}>{body}</Link>
                  ) : (
                    body
                  )}
                </li>
              );
            }),
          )}
        </ul>
      )}
      {!user && (
        <p className="mt-4 text-xs text-muted">{t("crew.membersOnlyRsvp")}</p>
      )}
    </main>
  );
}
