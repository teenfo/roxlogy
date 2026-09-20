import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { todayISOIn } from "@/lib/format";
import { CrewMeetupForm, CrewRsvpToggle, RacePlanForm, type MyRacePlan } from "@/components/crew-schedule-forms";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Hint, Panel } from "@/components/rox/ui";

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
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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

/**
 * 크루 일정 — 시안 crew.tsx CrewSchedule(목록) 그대로 (PORT_PLAN §3-e):
 * .rx-subhead("9월 크루 일정" + 월 이동) · Panel[ .rx-meeting-row(.rx-calendar-date · 제목/부제 · Chip · 화살표) ].
 * 시안의 예정/지난 Segments 대신 우리는 월 단위로 넘긴다. 참석 토글·모임 등록·내 대회일정은 우리 것(§4).
 */
export default async function CrewSchedulePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ m?: string }> }) {
  const { slug } = await params;
  const { m } = await searchParams;

  const [crew, user, { t, tag, tz }] = await Promise.all([getCrew(slug), getCachedUser(), getT()]);
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
    // 내가 만든 계획 + 파트너로 초대받은 계획 (RPC 가 합쳐 준다)
    isMember ? supabase.rpc("my_race_plans") : Promise.resolve({ data: [] }),
  ]);
  const plans = (myPlans ?? []) as MyRacePlan[];
  const cal = ((rows ?? []) as CalRow[]).slice().sort((a, b) => a.on_date.localeCompare(b.on_date) || (a.starts_at ?? "").localeCompare(b.starts_at ?? ""));

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(tag, { year: "numeric", month: "long" });
  const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const todayIso = todayISOIn(tz);

  // "다음 모임" = 오늘 이후 가장 이른 미종료 모임 하나.
  const firstUpcoming = (rows: CalRow[]) =>
    rows
      .filter((r) => r.kind === "meetup" && !r.closed && r.on_date >= todayIso)
      .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))[0]?.ref_id;

  let nextMeetupId = firstUpcoming(cal);
  // 미래 달을 보고 있으면 이 달 안에서 고른 건 "다음"이 아니다 — 그 사이에
  // 더 이른 모임이 있다. 오늘부터 이 달 끝까지 다시 훑는다.
  if (from > todayIso && to >= todayIso) {
    const { data: aheadRows } = await supabase.rpc("crew_calendar", { p_slug: slug, p_from: todayIso, p_to: to });
    nextMeetupId = firstUpcoming((aheadRows ?? []) as CalRow[]);
  }

  const monthShort = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(tag, { month: "short" }).toUpperCase();
  const dayNum = (iso: string) => Number(iso.slice(8, 10));
  const kindLabel = {
    meetup: t("crew.schedKindMeetup"),
    race: t("crew.schedKindRace"),
    program: t("crew.schedKindProgram"),
  } as const;

  return (
    <>
      <div className="rx-subhead">
        <h2>{t("crew.schedTitle", { month: monthLabel })}</h2>
        <div className="rx-actions" style={{ marginTop: 0 }}>
          <Button asChild variant="outline" size="icon">
            <Link href={`/crews/${slug}/schedule?m=${shiftMonth(month, -1)}`} aria-label={t("crew.prevMonth")}>
              <ChevronLeft size={18} />
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon">
            <Link href={`/crews/${slug}/schedule?m=${shiftMonth(month, 1)}`} aria-label={t("crew.nextMonth")}>
              <ChevronRight size={18} />
            </Link>
          </Button>
          {isMember && <RacePlanForm myPlans={plans} part="trigger" today={todayIso} />}
          {isStaff && <CrewMeetupForm crewId={crew.id} />}
        </div>
      </div>

      {/* 내 대회일정 — 시안 "내 레이스 일정" 의 RowLink 목록(§4) */}
      {isMember && plans.length > 0 && (
        <Panel title={t("schedule.myRaces")}>
          <RacePlanForm myPlans={plans} part="list" today={todayIso} />
        </Panel>
      )}

      <Panel>
        {!cal.length ? (
          <Empty title={t("crew.schedEmpty")} description={t("crew.noUpcoming")} />
        ) : (
          cal.map((r, i) => {
            const isNext = r.kind === "meetup" && r.ref_id === nextMeetupId;
            const done = r.kind === "meetup" && r.closed;
            const href =
              r.kind === "meetup"
                ? `/crews/${slug}/schedule/${r.ref_id}`
                : r.kind === "program"
                  ? `/programs/${r.ref_id}`
                  : // 내 계획이면 내 대회일정 상세로(목표·파트너가 거기 있다). 남의 계획은 공식 대회 페이지로,
                    // 그마저 연결이 없으면 갈 곳이 없다.
                    r.member_id && r.member_id === user?.id
                    ? `/schedule/race/${r.ref_id}?from=${encodeURIComponent(`/crews/${slug}/schedule`)}`
                    : r.event_id
                      ? `/events/${r.event_id}`
                      : null;
            const sub = [
              r.starts_at ? timeLabel(r.starts_at) : null,
              r.subtitle || null,
              r.kind !== "meetup" ? (kindLabel[r.kind] ?? r.kind) : null,
              r.kind === "race" && r.member_name ? r.member_name : null,
              r.kind === "race" && r.result_ms != null ? `🏁 ${fmtResult(r.result_ms)}` : null,
              r.kind === "meetup" ? (r.going_count ? t("crew.goingN", { n: r.going_count }) : t("crew.goingNone")) : null,
              r.members_only ? t("crew.fullOnly") : null,
              r.kind === "meetup" && r.fee_exempt ? t("crew.feeExempt") : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const head = (
              <>
                <div className="rx-calendar-date">
                  <small>{monthShort(r.on_date)}</small>
                  <strong>{dayNum(r.on_date)}</strong>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3>{r.title}</h3>
                  <p>{sub}</p>
                </div>
              </>
            );
            const chip = (
              <Chip tone={done ? "neutral" : isNext ? "yellow" : r.kind === "race" ? "blue" : "neutral"}>
                {done ? t("crew.closed") : isNext ? t("crew.nextMeetup") : r.kind === "meetup" ? t("crew.schedKindMeetup") : (kindLabel[r.kind] ?? r.kind)}
              </Chip>
            );
            const key = `${r.kind}-${r.ref_id}-${i}`;
            const dim = done ? { opacity: 0.6 } : undefined;
            if (r.kind === "meetup" && isMember) {
              // 참석 토글은 링크 밖에 둔다 — 앵커 안에 버튼을 넣으면 토글을 눌러도 상세로 넘어간다
              return (
                <div className="rx-meeting-row" key={key} style={dim}>
                  <Link href={href!} style={{ display: "flex", alignItems: "center", gap: 20, flex: 1, minWidth: 0 }}>
                    {head}
                  </Link>
                  {chip}
                  <CrewRsvpToggle eventId={r.ref_id} myStatus={r.my_status} closed={r.closed} />
                </div>
              );
            }
            return href ? (
              <Link className="rx-meeting-row" key={key} href={href} style={dim}>
                {head}
                {chip}
                <ArrowRight size={19} />
              </Link>
            ) : (
              <div className="rx-meeting-row" key={key} style={dim}>
                {head}
                {chip}
              </div>
            );
          })
        )}
      </Panel>
      {!user && <Hint>{t("crew.membersOnlyRsvp")}</Hint>}
    </>
  );
}
