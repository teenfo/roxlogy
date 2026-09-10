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
  /** 공식 대회에 연결된 내 대회일정이면 그 대회 id */
  event_id: string | null;
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

  // "다음 모임" = 오늘 이후 가장 이른 미종료 모임 하나.
  const firstUpcoming = (rows: CalRow[]) =>
    rows
      .filter((r) => r.kind === "meetup" && !r.closed && r.on_date >= todayIso)
      .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))[0]
      ?.ref_id;

  let nextMeetupId = firstUpcoming(cal);
  // 미래 달을 보고 있으면 이 달 안에서 고른 건 "다음"이 아니다 — 그 사이에
  // 더 이른 모임이 있다. 오늘부터 이 달 끝까지 다시 훑는다.
  if (from > todayIso && to >= todayIso) {
    const { data: aheadRows } = await supabase.rpc("crew_calendar", {
      p_slug: slug,
      p_from: todayIso,
      p_to: to,
    });
    nextMeetupId = firstUpcoming((aheadRows ?? []) as CalRow[]);
  }

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
      {/* 내 대회일정 목록 — 등록 폼과 인라인 수정이 함께 펼쳐지므로 좌우 칸에
          끼우지 않고 월 바 위 전체 폭에 둔다. 등록 버튼만 아래 툴바 좌측에. */}
      {isMember && (myPlans ?? []).length > 0 && (
        <div className="mb-3">
          <RacePlanForm myPlans={(myPlans ?? []) as MyRacePlan[]} part="list" />
        </div>
      )}

      {/* 툴바 — 좌: 내 대회일정 등록 · 중앙: 월 이동 · 우: 모임 등록.
          flex 가 아니라 grid 인 이유는, 한쪽 버튼이 없어도(스태프가 아니거나
          비회원) 월 바가 가운데에 그대로 있어야 하기 때문이다. */}
      <div className="grid items-center gap-3 max-md:grid-cols-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex min-w-0 max-md:order-2">
          {isMember && (
            <RacePlanForm
              myPlans={(myPlans ?? []) as MyRacePlan[]}
              part="trigger"
            />
          )}
        </div>

        <div className="flex items-center justify-center rounded-[10px] border border-line-mid bg-control max-md:order-1 max-md:col-span-2 max-md:w-fit max-md:justify-self-center">
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

        <div className="flex min-w-0 justify-end max-md:order-3">
          {isStaff && <CrewMeetupForm crewId={crew.id} />}
        </div>
      </div>

      {/* 일정 리스트 — 날짜 하나에 카드 하나. 같은 날 일정이 여러 개면
          날짜 블록을 반복하지 않고 그 안에 쌓는다. */}
      {!dates.length ? (
        <Card className="mt-6 px-4 py-10 text-center">
          <p className="text-sm text-muted">{t("crew.schedEmpty")}</p>
        </Card>
      ) : (
        <ul className="mt-6 flex flex-col gap-2.5">
          {dates.map((d) => {
            const items = byDate.get(d)!;
            const hasNext = items.some(
              (r) => r.kind === "meetup" && r.ref_id === nextMeetupId,
            );
            return (
              <li key={d}>
                <div
                  className={`grid grid-cols-[64px_minmax(0,1fr)] items-start gap-4 rounded-2xl border px-5 py-4 max-md:grid-cols-[52px_minmax(0,1fr)] max-md:gap-3 max-md:px-4 ${
                    hasNext
                      ? "border-line-accent bg-highlight"
                      : "border-line bg-card"
                  }`}
                >
                  {/* 날짜 블록 — 그 날 전체가 한 번만 */}
                  <div className="self-stretch border-r border-line-mid pr-3 text-center">
                    <p
                      className={`tabular text-[30px] font-extrabold leading-none max-md:text-2xl ${
                        hasNext
                          ? "text-accent"
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

                  <ul className="min-w-0 divide-y divide-line">
                    {items.map((r, i) => {
                      const isNext =
                        r.kind === "meetup" && r.ref_id === nextMeetupId;
                      const done = r.kind === "meetup" && r.closed;
                      const names = goingNames.get(r.ref_id) ?? [];
                      const href =
                        r.kind === "meetup"
                          ? `/crews/${slug}/schedule/${r.ref_id}`
                          : r.kind === "program"
                            ? `/programs/${r.ref_id}`
                            : // 공식 대회에 연결된 내 대회일정이면 그 대회
                              // 페이지로 — 장소·일시·공식 링크·라이브 결과가
                              // 이미 거기 있다. 직접 입력한 계획은 갈 곳이 없다.
                              r.event_id
                              ? `/events/${r.event_id}`
                              : null;

                      const text = (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-[18px] font-bold max-md:text-base">
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
                            {done && (
                              <Badge tone="neutral">{t("crew.closed")}</Badge>
                            )}
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
                            {r.subtitle && (
                              <span className="truncate">{r.subtitle}</span>
                            )}
                            {r.kind === "race" && r.member_name && (
                              <span className="text-info">{r.member_name}</span>
                            )}
                            {r.kind === "race" && r.result_ms != null && (
                              <span className="tabular font-bold text-info">
                                🏁 {fmtResult(r.result_ms)}
                              </span>
                            )}
                          </p>
                        </>
                      );

                      return (
                        <li
                          key={`${r.kind}-${r.ref_id}-${i}`}
                          className={`grid items-center gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] ${
                            done ? "opacity-55" : ""
                          }`}
                        >
                          {/* 참석 토글은 링크 밖에 둔다 — 앵커 안에 버튼을
                              넣으면 토글을 눌러도 상세로 넘어간다 */}
                          {href ? (
                            <Link
                              href={href}
                              className="block min-w-0 transition-opacity hover:opacity-80"
                            >
                              {text}
                            </Link>
                          ) : (
                            <div className="min-w-0">{text}</div>
                          )}

                          {r.kind === "meetup" && (
                            <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
                              {names.length > 0 && <AvatarStack names={names} />}
                              <span className="text-xs text-muted">
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
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!user && (
        <p className="mt-4 text-xs text-muted">{t("crew.membersOnlyRsvp")}</p>
      )}
    </main>
  );
}
