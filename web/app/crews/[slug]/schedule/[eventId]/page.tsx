import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  CrewAttendanceCheck,
  CrewEventFeeToggle,
  CrewEventShare,
  CrewEventCommentForm,
  CrewMeetupCancel,
  CrewRsvpButtons,
  type AttendanceRow,
} from "@/components/crew-schedule-forms";
import { formatDate } from "@/lib/format";
import { siteUrl } from "@/lib/site-url";

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
  going_names: string[];
  maybe_names: string[];
  declined_names: string[];
  my_status: string | null;
  is_staff: boolean;
  comments_allowed: boolean;
  comments: EventComment[];
  waitlist_names: string[];
  fee_exempt: boolean;
  members_only: boolean;
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
  if (!ev || ev.slug !== slug) notFound();

  const isMember = crew.my_status === "active";
  // 외부에서 타고 들어올 수 있는 절대 주소 (카톡·인스타에 붙이는 용도)
  const shareUrl = `${siteUrl()}/crews/${slug}/schedule/${eventId}`;
  // 출석 명단 — 크루원만 (RPC 가 비회원에게는 빈 결과를 준다)
  const { data: attRows } = isMember
    ? await supabase.rpc("crew_event_attendance", { p_event: eventId })
    : { data: [] as AttendanceRow[] };
  const attendance = (attRows ?? []) as AttendanceRow[];
  const when = new Date(ev.starts_at).toLocaleString(tag, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: tz,
  });

  return (
    <main>
      <Link
        href={`/crews/${slug}/schedule`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← {t("crew.schedTab")}
      </Link>

      <div className="mt-4 flex items-start justify-between gap-3">
        <h2 className="text-xl font-bold">{ev.title}</h2>
        <span className="flex shrink-0 items-center gap-2">
          <CrewEventShare url={shareUrl} title={ev.title} />
          {ev.is_staff && <CrewMeetupCancel eventId={ev.id} slug={slug} />}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-accent">{when}</p>
      <span className="mt-1 flex flex-wrap gap-1.5">
        {ev.members_only && (
          <span className="rounded-full bg-track/15 px-2.5 py-0.5 text-[11px] font-bold text-track">
            {t("crew.fullOnly")}
          </span>
        )}
        {ev.fee_exempt && (
          <span className="rounded-full bg-track/15 px-2.5 py-0.5 text-[11px] font-bold text-track">
            {t("crew.feeExempt")}
          </span>
        )}
      </span>
      {ev.location && <p className="mt-1 text-sm text-muted">📍 {ev.location}</p>}
      {ev.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">
          {ev.description}
        </p>
      )}

      {/* 참석 체크 */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold text-muted">{t("crew.rsvpQuestion")}</h3>
        <div className="mt-2">
          {isMember ? (
            <CrewRsvpButtons eventId={ev.id} myStatus={ev.my_status} />
          ) : (
            <p className="text-sm text-muted">{t("crew.membersOnlyRsvp")}</p>
          )}
        </div>
      </section>

      {/* 참석 명단 */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold text-muted">
          {t("crew.goingList")} ({ev.going_names.length}
          {ev.capacity ? `/${ev.capacity}` : ""})
        </h3>
        {ev.going_names.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ev.going_names.map((n, i) => (
              <li
                key={i}
                className="rounded-full bg-surface px-3 py-1 text-xs font-medium"
              >
                {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted">—</p>
        )}
        {ev.waitlist_names.length > 0 && (
          <p className="mt-3 text-xs text-accent">
            ⏳ {t("crew.waitlistTitle")} ({ev.waitlist_names.length}):{" "}
            {ev.waitlist_names.join(", ")}
          </p>
        )}
        {ev.maybe_names.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {t("crew.rsvpMaybe")} ({ev.maybe_names.length}):{" "}
            {ev.maybe_names.join(", ")}
          </p>
        )}
        {ev.declined_names.length > 0 && (
          <p className="mt-1 text-xs text-muted">
            {t("crew.rsvpDeclined")} ({ev.declined_names.length}):{" "}
            {ev.declined_names.join(", ")}
          </p>
        )}
      </section>

      {/* 출석 — 운영진이 체크, 크루원은 결과만. RSVP 와 별개다. */}
      {isMember && (
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-muted">
              {t("crew.attendTitle")}
            </h3>
            {ev.is_staff && (
              <CrewEventFeeToggle
                eventId={ev.id}
                feeExempt={ev.fee_exempt}
                membersOnly={ev.members_only}
              />
            )}
          </div>
          {ev.fee_exempt && (
            <p className="mt-1 text-[11px] text-muted">
              {t("crew.feeExemptNote")}
            </p>
          )}
          <div className="mt-2">
            <CrewAttendanceCheck
              eventId={ev.id}
              rows={attendance}
              canEdit={ev.is_staff}
              started={new Date(ev.starts_at) <= new Date()}
            />
          </div>
        </section>
      )}

      {/* 댓글 — 허용된 모임만. 입력은 크루원, 권한은 RLS 가 최종 강제 */}
      {ev.comments_allowed && (
        <section className="mt-8">
          <h3 className="text-sm font-semibold text-muted">
            {t("crew.comments")}{" "}
            <span className="font-normal">{ev.comments.length}</span>
          </h3>

          {!!ev.comments.length && (
            <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-md bg-muted/20">
              {ev.comments.map((c) => (
                <li key={c.id} className="bg-surface px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/u/${c.author_id}`}
                      className="text-xs font-semibold hover:text-accent"
                    >
                      {c.author_name}
                    </Link>
                    <span className="text-[11px] text-muted">
                      {formatDate(c.created_at, tag, tz)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{c.body}</p>
                </li>
              ))}
            </ul>
          )}

          {isMember ? (
            <CrewEventCommentForm eventId={ev.id} />
          ) : (
            <p className="mt-4 text-center text-xs text-muted">
              {t("crew.memberOnly")}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
