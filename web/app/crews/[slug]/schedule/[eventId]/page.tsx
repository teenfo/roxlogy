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
  CrewEventCommentForm,
  CrewMeetupCancel,
  CrewMeetupForm,
  CrewRsvpButtons,
  type AttendanceRow,
} from "@/components/crew-schedule-forms";
import { formatDate } from "@/lib/format";
import { siteUrl } from "@/lib/site-url";
import { tierBadgeClass } from "@/lib/crew-role";

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
          {ev.is_staff && (
            <CrewEventClose eventId={ev.id} closed={ev.closed_at != null} />
          )}
          {ev.is_staff && <CrewMeetupCancel eventId={ev.id} slug={slug} />}
        </span>
      </div>

      {/* 내용 수정 — 무료 행사·정회원 전용은 아래 전용 토글에서 다룬다
          (회차비 회수·숨겨진 참석자 안내가 거기 붙어 있다) */}
      {ev.is_staff && (
        <div className="mt-3">
          <CrewMeetupForm
            event={{
              id: ev.id,
              title: ev.title,
              starts_at: ev.starts_at,
              location: ev.location,
              description: ev.description,
              capacity: ev.capacity,
              comments_allowed: ev.comments_allowed,
            }}
          />
        </div>
      )}
      <p className="mt-1 text-sm font-medium text-accent">{when}</p>
      <span className="mt-1 flex flex-wrap gap-1.5">
        {ev.closed_at && (
          <span className="rounded-full bg-muted/20 px-2.5 py-0.5 text-[11px] font-bold text-muted">
            {t("crew.closed")}
          </span>
        )}
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
            <>
              <CrewRsvpButtons
                eventId={ev.id}
                myStatus={ev.my_status}
                closed={ev.closed_at != null}
              />
              {ev.closed_at && (
                <p className="mt-2 text-xs text-muted">{t("crew.closedNote")}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">{t("crew.membersOnlyRsvp")}</p>
          )}
        </div>
      </section>

      {/* 참석 명단 */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold text-muted">
          {t("crew.goingList")} ({ev.going.length}
          {ev.capacity ? `/${ev.capacity}` : ""})
        </h3>
        {ev.going.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {/* 등급은 크루원에게만 채워져 온다 (RPC 에서 익명은 null) */}
            {ev.going.map((g, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-medium"
              >
                {g.name}
                {g.tier && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tierBadgeClass(g.color)}`}
                  >
                    {g.tier}
                  </span>
                )}
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
        {/* 미정은 인원수만 — 이름까지 나열할 이유가 없다 */}
        {ev.maybe_names.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {t("crew.rsvpMaybe")} {ev.maybe_names.length}
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
                <li key={c.id} className="bg-card px-4 py-3">
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
