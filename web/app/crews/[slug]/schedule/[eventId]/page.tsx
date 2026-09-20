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
import { AccessGate } from "@/components/ui/access-gate";
import { Back, Chip, DataTable, Empty, Hint, PageHead, Panel } from "@/components/rox/ui";

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
export async function generateMetadata({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
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

/**
 * 모임 상세 — 시안 crew.tsx CrewSchedule(id) 그대로 (PORT_PLAN §3-e):
 * Back · PageHead(제목, 일시·장소) · two-col[ Panel "모임 소개"(Chip · .rx-lead · DataTable 안내/내용 · Hint)
 * | Panel "내 참석 여부"(Segments · .rx-lead 참석 N명 · Hint) ] · Panel "댓글 N"(.rx-actions Input+Button · .rx-note-row).
 * 공유·운영진 ⋯ 메뉴는 PageHead action 에, 출석 체크 카드는 시안에 없어 Panel 로만(§4).
 */
export default async function CrewEventPage({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
  const { slug, eventId } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_event_detail", { p_event: eventId });
  const ev = ((data ?? []) as EventDetail[])[0];

  // 공유 링크로 들어온 사람 처리. 안 보인다고 곧장 404 를 내면 정회원 전용
  // 모임 링크를 받은 사람은 이유도 모른 채 막힌다 — 사유를 구분한다.
  if (!ev || ev.slug !== slug) {
    const { data: gateRow } = await supabase.rpc("crew_event_gate", { p_event: eventId });
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
      redirect(`/login?next=${encodeURIComponent(`/crews/${slug}/schedule/${eventId}`)}`);
    }
    // 로그인은 했는데 정회원이 아니다 → 로그인시켜도 소용없으니 이유를 보여준다
    return (
      <>
        <Back href={`/crews/${slug}/schedule`} label={t("crew.schedTab")} />
        <AccessGate title={t("crew.eventMembersOnly")} reason={t("crew.eventMembersOnlyDesc", { crew: gate.crew })} action={{ href: `/crews/${slug}`, label: t("crew.about") }} />
      </>
    );
  }

  const isMember = crew.my_status === "active";
  // 외부에서 타고 들어올 수 있는 절대 주소 (카톡·인스타에 붙이는 용도)
  const shareUrl = `${siteUrl()}/crews/${slug}/schedule/${eventId}`;
  // 출석 명단 — 크루원만 (RPC 가 비회원에게는 빈 결과를 준다)
  const [{ data: attRows }, profile] = await Promise.all([
    isMember ? supabase.rpc("crew_event_attendance", { p_event: eventId }) : Promise.resolve({ data: [] as AttendanceRow[] }),
    getCachedProfile(),
  ]);
  const attendance = (attRows ?? []) as AttendanceRow[];

  const startsAt = new Date(ev.starts_at);
  const when = startsAt.toLocaleString(tag, { dateStyle: "full", timeStyle: "short", timeZone: tz });
  const started = startsAt <= new Date();

  // 무응답 = 크루원 중 어떤 응답도 하지 않은 사람. 음수가 되지 않게 막는다.
  const answered = ev.going.length + ev.maybe_names.length + ev.declined_names.length;
  const noReply = Math.max(0, crew.member_count - answered);

  const state = ev.closed_at ? t("crew.closed") : started ? t("crew.attendCheckTab") : t("crew.nextMeetup");
  const infoRows: [string, string][] = [
    [t("crew.colWhen"), when],
    ...(ev.location ? [[t("crew.eventPlace"), ev.location] as [string, string]] : []),
    [t("crew.eventAudience"), ev.members_only ? t("crew.fullOnly") : t("crew.allMembers")],
    [t("crew.eventFee"), ev.fee_exempt ? t("crew.feeNone") : t("crew.feeByTier")],
    ...(ev.capacity ? [[t("crew.capacityN", { n: ev.capacity }), `${ev.going.length} / ${ev.capacity}`] as [string, string]] : []),
  ];
  const tally = [
    `${t("crew.rsvpGoing")} ${ev.going.length}`,
    `${t("crew.rsvpMaybe")} ${ev.maybe_names.length}`,
    `${t("crew.rsvpDeclined")} ${ev.declined_names.length}`,
    ...(isMember ? [`${t("crew.rsvpNone")} ${noReply}`] : []),
    ...(ev.waitlist_names.length ? [`${t("crew.rsvpWaitlisted")} ${ev.waitlist_names.length}`] : []),
  ].join(" · ");

  return (
    <>
      <Back href={`/crews/${slug}/schedule`} label={t("crew.schedTab")} />
      <PageHead
        title={ev.title}
        description={[when, ev.location].filter(Boolean).join(" · ")}
        action={
          <div className="rx-actions" style={{ marginTop: 0 }}>
            <CrewEventShare url={shareUrl} title={ev.title} />
            {ev.is_staff && (
              /* 수정·종료·취소를 ⋯ 하나로. 수정 폼은 열면 RoxDialog 로 뜬다 */
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
        }
      />
      <div className="rx-two-col">
        <Panel title={t("crew.meetupInfo")}>
          <div className="rx-actions" style={{ marginTop: 0 }}>
            <Chip tone={ev.closed_at ? "neutral" : "yellow"}>{state}</Chip>
            {ev.members_only && <Chip tone="blue">{t("crew.fullOnly")}</Chip>}
            {ev.fee_exempt && <Chip tone="blue">{t("crew.feeExempt")}</Chip>}
          </div>
          {ev.description && (
            <p className="rx-lead" style={{ whiteSpace: "pre-wrap" }}>
              {ev.description}
            </p>
          )}
          <DataTable headers={[t("crew.eventInfoHeader"), t("crew.eventInfoValue")]} rows={infoRows.map(([k, v]) => [k, <span key={k} className="rx-wrap">{v}</span>])} />
          <Hint>{tally}</Hint>
        </Panel>
        <Panel title={t("crew.rsvpSummary")}>
          {isMember ? (
            <>
              <CrewRsvpButtons eventId={ev.id} myStatus={ev.my_status} closed={ev.closed_at != null} />
              <p className="rx-lead">{t("crew.goingN", { n: ev.going.length })}</p>
              {ev.closed_at && <Hint>{t("crew.closedNote")}</Hint>}
            </>
          ) : (
            <>
              <p className="rx-lead">{t("crew.goingN", { n: ev.going.length })}</p>
              <Hint>{t("crew.membersOnlyRsvp")}</Hint>
            </>
          )}
        </Panel>
      </div>

      {/* 참석 명단 · 출석 체크 — 시안에 없음(§4) */}
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
          settings={ev.is_staff ? <CrewEventFeeToggle eventId={ev.id} feeExempt={ev.fee_exempt} membersOnly={ev.members_only} /> : undefined}
        />
      ) : (
        /* 비회원은 참석 명단만 (등급은 RPC 가 비워서 준다) */
        <Panel title={`${t("crew.goingList")} (${ev.going.length}${ev.capacity ? `/${ev.capacity}` : ""})`}>
          {ev.going.length ? (
            <div className="rx-actions" style={{ marginTop: 0 }}>
              {ev.going.map((g, i) => (
                <Chip key={i}>{g.name}</Chip>
              ))}
            </div>
          ) : (
            <Empty title={t("crew.rsvpEmpty")} description={t("crew.goingListNote")} />
          )}
        </Panel>
      )}

      {/* 댓글 — 허용된 모임만. 입력은 크루원, 권한은 RLS 가 최종 강제 */}
      {ev.comments_allowed && (
        <Panel title={`${t("crew.comments")} ${ev.comments.length}`}>
          {isMember ? <CrewEventCommentForm eventId={ev.id} myName={profile?.display_name ?? "Athlete"} /> : <Hint>{t("crew.memberOnly")}</Hint>}
          {ev.comments.length ? (
            ev.comments.map((c) => (
              <p className="rx-note-row" key={c.id}>
                <b>
                  <Link href={`/u/${c.author_id}`}>{c.author_name}</Link> · {formatDate(c.created_at, tag, tz)}
                </b>
                <br />
                {c.body}
              </p>
            ))
          ) : (
            <Hint>{t("crew.noComments")}</Hint>
          )}
        </Panel>
      )}
    </>
  );
}
