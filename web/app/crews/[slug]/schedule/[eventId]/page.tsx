import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  CrewAttendanceCheck,
  CrewEventFeeToggle,
  CrewEventClose,
  CrewEventShare,
  CrewEventStaffActions,
  CrewEventCommentForm,
  CrewMeetupCancel,
  CrewRsvpButtons,
  type AttendanceRow,
} from "@/components/crew-schedule-forms";
import { formatDate } from "@/lib/format";
import { siteUrl } from "@/lib/site-url";
import { getCachedProfile } from "@/lib/supabase/auth";
import { Avatar, Card } from "@/components/ui/crew-ui";

type EventComment = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

type EventDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  capacity: number | null;
  going: { name: string; tier: string | null; color: string | null }[];
  maybe_names: string[];
  declined_names: string[];
  my_status: string | null;
  is_staff: boolean;
  comments_allowed: boolean;
  comments: EventComment[];
  waitlist_names: string[];
  fee_exempt: boolean;
  members_only: boolean;
  closed_at: string | null;
};

/** 카톡·인스타에 붙였을 때 제목·설명이 보이도록 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_event_detail", { p_event: eventId });
  const ev = ((data ?? []) as EventDetail[])[0];
  if (!ev) return { title: "Roxlogy" };
  return {
    title: `${ev.title} — Roxlogy`,
    description: ev.description?.slice(0, 160) ?? ev.location ?? undefined,
  };
}

export default async function CrewEventPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_event_detail", { p_event: eventId });
  const ev = ((data ?? []) as EventDetail[])[0];

  // 공유 링크로 들어온 사람 처리. 안 보인다고 곧장 404 를 내면 정회원 전용
  // 모임 링크를 받은 사람은 이유도 모른 채 막힌다 — 사유를 구분한다.
  if (!ev || ev.slug !== slug) {
    const { data: gateRow } = await supabase.rpc("crew_event_gate", {
      p_event: eventId,
    });
    const gate = gateRow as {
      slug: string;
      crew: string;
      members_only: boolean;
      visible: boolean;
      logged_in: boolean;
    } | null;
    // 없는 모임이거나 비공개 크루 → 진짜 404 (존재 여부를 흘리지 않는다)
    if (!gate || gate.slug !== slug) notFound();
    // 로그인만 하면 될 수 있다 → 로그인 후 이 링크로 돌아온다
    if (!gate.logged_in) {
      redirect(
        `/login?next=${encodeURIComponent(`/crews/${slug}/schedule/${eventId}`)}`,
      );
    }
    // 로그인은 했는데 정회원이 아니다 → 로그인시켜도 소용없으니 이유를 보여준다
    return (
      <main>
        <Link
          href={`/crews/${slug}/schedule`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← {t("crew.schedTab")}
        </Link>
        <div className="mt-6 rounded-xl border border-line bg-card px-5 py-10 text-center">
          <p className="text-sm font-semibold">{t("crew.eventMembersOnly")}</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted">
            {t("crew.eventMembersOnlyDesc", { crew: gate.crew })}
          </p>
          <Link
            href={`/crews/${slug}`}
            className="mt-4 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110"
          >
            {t("crew.about")}
          </Link>
        </div>
      </main>
    );
  }

  const isMember = crew.my_status === "active";
  // 외부에서 타고 들어올 수 있는 절대 주소 (카톡·인스타에 붙이는 용도)
  const shareUrl = `${siteUrl()}/crews/${slug}/schedule/${eventId}`;
  // 출석 명단 — 크루원만 (RPC 가 비회원에게는 빈 결과를 준다)
  const [{ data: attRows }, profile] = await Promise.all([
    isMember
      ? supabase.rpc("crew_event_attendance", { p_event: eventId })
      : Promise.resolve({ data: [] as AttendanceRow[] }),
    getCachedProfile(),
  ]);
  const attendance = (attRows ?? []) as AttendanceRow[];

  const startsAt = new Date(ev.starts_at);
  const when = startsAt.toLocaleString(tag, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: tz,
  });
  // 날짜 블록 — 월/일/요일을 모임 시간대(tz) 기준으로 쪼갠다
  const dpart = (opt: Intl.DateTimeFormatOptions) =>
    startsAt.toLocaleDateString(tag, { ...opt, timeZone: tz });
  const started = startsAt <= new Date();

  // 무응답 = 크루원 중 어떤 응답도 하지 않은 사람. 음수가 되지 않게 막는다.
  const answered =
    ev.going.length + ev.maybe_names.length + ev.declined_names.length;
  const noReply = Math.max(0, crew.member_count - answered);
  const checked = attendance.filter((r) => r.checked_in).length;

  const badges: { label: string; cls: string }[] = [];
  if (ev.closed_at)
    badges.push({ label: t("crew.closed"), cls: "bg-line text-muted" });
  if (ev.members_only)
    badges.push({ label: t("crew.fullOnly"), cls: "bg-label-bg text-label" });
  if (ev.fee_exempt)
    badges.push({ label: t("crew.feeExempt"), cls: "bg-label-bg text-label" });
  if (ev.capacity)
    badges.push({
      label: t("crew.capacityN", { n: ev.capacity }),
      cls: "bg-accent/15 text-accent-dim",
    });

  const tally: { label: string; value: number; cls?: string }[] = [
    { label: t("crew.rsvpGoing"), value: ev.going.length, cls: "text-success" },
    { label: t("crew.rsvpMaybe"), value: ev.maybe_names.length },
    { label: t("crew.rsvpDeclined"), value: ev.declined_names.length },
  ];
  if (isMember) tally.push({ label: t("crew.rsvpNone"), value: noReply });
  if (ev.waitlist_names.length)
    tally.push({
      label: t("crew.rsvpWaitlisted"),
      value: ev.waitlist_names.length,
      cls: "text-accent",
    });

  return (
    <main className="flex flex-col gap-3.5">
      {/* 히어로 — 날짜 블록 · 제목/메타 · 운영진 액션 */}
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
            {badges.length > 0 && (
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
            )}
            <h2 className="text-[26px] font-extrabold tracking-[-0.02em] [word-break:keep-all] max-md:text-[22px]">
              {ev.title}
            </h2>
            <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-foreground/80">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="text-muted">
                  ◷
                </span>
                {when}
              </span>
              {ev.location && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="text-muted">
                    ◎
                  </span>
                  {ev.location}
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 max-md:col-span-2 max-md:justify-end">
            {/* 목록으로 — 상단에 따로 두는 것보다 액션들과 한 줄에 있는 편이 찾기 쉽다 */}
            <Link
              href={`/crews/${slug}/schedule`}
              className="flex h-[34px] shrink-0 items-center rounded-lg border border-line-strong bg-control px-3.5 text-[13px] font-semibold transition-colors hover:border-[#555]"
            >
              ← {t("crew.schedTab")}
            </Link>
            <CrewEventShare url={shareUrl} title={ev.title} />
            {ev.is_staff && (
              /* 수정·종료·취소를 ⋯ 하나로. 수정 폼은 열면 오버레이로 뜬다 */
              <CrewEventStaffActions
                event={{
                  id: ev.id,
                  title: ev.title,
                  starts_at: ev.starts_at,
                  location: ev.location,
                  description: ev.description,
                  capacity: ev.capacity,
                  comments_allowed: ev.comments_allowed,
                }}
              >
                <CrewEventClose eventId={ev.id} closed={ev.closed_at != null} />
                <CrewMeetupCancel eventId={ev.id} slug={slug} />
              </CrewEventStaffActions>
            )}
          </div>
        </div>

        {/* 지표 행 */}
        <div className="grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-3">
          <div className="px-6 py-3.5 max-md:px-4">
            <p className="text-xs text-muted">{t("crew.rsvpGoing")}</p>
            <p className="tabular mt-0.5 text-[22px] font-extrabold max-md:text-lg">
              {ev.going.length}
              <span className="text-sm font-bold text-muted">
                {" / "}
                {crew.member_count}
              </span>
            </p>
          </div>
          {isMember && (
            <div className="px-6 py-3.5 max-md:px-4">
              <p className="text-xs text-muted">{t("crew.attendCheckTab")}</p>
              <p className="tabular mt-0.5 text-[22px] font-extrabold text-accent max-md:text-lg">
                {checked}
                <span className="text-sm font-bold text-muted">
                  {" / "}
                  {ev.going.length}
                </span>
              </p>
            </div>
          )}
          <div className="px-6 py-3.5 max-md:px-4 max-sm:col-span-2 max-sm:border-t max-sm:border-line">
            <p className="text-xs text-muted">{t("crew.feeLabel")}</p>
            <p className="mt-0.5 text-[15px] font-bold text-label max-md:text-sm">
              {ev.fee_exempt ? t("crew.feeNone") : t("crew.feeByTier")}
            </p>
          </div>
        </div>
      </section>

      {/* 소개 + 내 참석 — 모바일은 내 참석이 먼저(주 행동이다) */}
      <div
        className={`grid items-start gap-3.5 ${
          ev.description ? "md:grid-cols-[minmax(0,1fr)_300px]" : ""
        }`}
      >
        {ev.description && (
          <Card className="px-[22px] py-5 max-md:order-2 max-md:px-4">
            <h3 className="text-[15px] font-extrabold">
              {t("crew.eventAbout")}
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.7] text-foreground/85 [word-break:keep-all]">
              {ev.description}
            </p>
          </Card>
        )}

        <Card className="flex flex-col gap-3 px-5 py-[18px] max-md:order-1 md:sticky md:top-4">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-extrabold">
              {t("crew.rsvpSummary")}
            </h3>
            {ev.closed_at && (
              <span className="ml-auto text-xs text-muted">
                {t("crew.closed")}
              </span>
            )}
          </div>

          {isMember ? (
            <>
              <CrewRsvpButtons
                eventId={ev.id}
                myStatus={ev.my_status}
                closed={ev.closed_at != null}
              />
              {ev.closed_at && (
                <p className="text-xs text-muted">{t("crew.closedNote")}</p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted">{t("crew.membersOnlyRsvp")}</p>
          )}

          <ul className="flex flex-col gap-2 border-t border-line pt-3">
            {tally.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between text-[13px]"
              >
                <span className="text-muted">{row.label}</span>
                <span className={`tabular font-bold ${row.cls ?? ""}`}>
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* 참석 명단 · 출석 체크 */}
      {isMember ? (
        <CrewAttendanceCheck
          eventId={ev.id}
          rows={attendance}
          going={ev.going}
          canEdit={ev.is_staff}
          started={started}
          memberCount={crew.member_count}
          waitlistNames={ev.waitlist_names}
          feeExempt={ev.fee_exempt}
          settings={
            ev.is_staff ? (
              <CrewEventFeeToggle
                eventId={ev.id}
                feeExempt={ev.fee_exempt}
                membersOnly={ev.members_only}
              />
            ) : undefined
          }
        />
      ) : (
        /* 비회원은 참석 명단만 (등급은 RPC 가 비워서 준다) */
        <Card className="px-[22px] py-5 max-md:px-4">
          <h3 className="text-[15px] font-extrabold">
            {t("crew.goingList")} ({ev.going.length}
            {ev.capacity ? `/${ev.capacity}` : ""})
          </h3>
          {ev.going.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {ev.going.map((g, i) => (
                <li
                  key={i}
                  className="rounded-full bg-page px-3 py-1 text-[13px] font-medium"
                >
                  {g.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-muted">—</p>
          )}
        </Card>
      )}

      {/* 댓글 — 허용된 모임만. 입력은 크루원, 권한은 RLS 가 최종 강제 */}
      {ev.comments_allowed && (
        <Card className="flex flex-col gap-3.5 px-[22px] py-[18px] max-md:px-4">
          <h3 className="flex items-baseline gap-2 text-[15px] font-extrabold">
            {t("crew.comments")}
            <span className="text-[13px] font-normal text-muted">
              {ev.comments.length}
            </span>
          </h3>

          {isMember ? (
            <CrewEventCommentForm
              eventId={ev.id}
              myName={profile?.display_name ?? "Athlete"}
            />
          ) : (
            <p className="text-center text-xs text-muted">
              {t("crew.memberOnly")}
            </p>
          )}

          {ev.comments.length ? (
            <ul className="flex flex-col">
              {ev.comments.map((c) => (
                <li
                  key={c.id}
                  className="flex gap-2.5 border-t border-line-soft py-3"
                >
                  <Avatar name={c.author_name} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <Link
                        href={`/u/${c.author_id}`}
                        className="text-[13px] font-bold hover:text-accent"
                      >
                        {c.author_name}
                      </Link>
                      <span className="text-[11px] text-muted">
                        {formatDate(c.created_at, tag, tz)}
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">
              {t("crew.noComments")}
            </p>
          )}
        </Card>
      )}
    </main>
  );
}
