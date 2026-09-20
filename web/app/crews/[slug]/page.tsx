import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, MapPin, Phone } from "lucide-react";
import { getCrew, getCrewBoard } from "@/lib/crew";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { DuesLink } from "@/components/crew-dues-links";
import { CrewDuesSelfReport, type MyCharge } from "@/components/crew-dues-check";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { CopyField } from "@/components/copy-field";
import { todayISOIn } from "@/lib/format";
import { won } from "@/lib/won";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Go, Panel, RecordRow } from "@/components/rox/ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const crew = await getCrew(slug);
  if (!crew) return { title: "Crew" };
  return {
    title: `${crew.name} — ${crew.tagline ?? "Crew"}`,
    description: crew.description?.slice(0, 160),
  };
}

type CalRow = {
  kind: "meetup" | "race" | "program";
  on_date: string;
  starts_at: string | null;
  ref_id: string;
  title: string;
  subtitle: string;
  going_count: number | null;
  my_status: string | null;
  closed: boolean;
};

/**
 * 크루 소개 — 시안 crew.tsx Crew() 의 overview 그대로 (PORT_PLAN §3-e):
 * two-col[ Panel(태그라인)[.rx-lead 소개 · .rx-info-grid · Chips] | Panel "다가오는 모임"(.rx-crew-next) ]
 * · two-col[ Panel "크루 공지"(RowLink) | Panel "나의 회비"(Chip · .rx-summary-time · Go) ].
 * 링크·계좌·납부 링크·운영 정책은 우리 것이라 Panel 로만 더한다(§4).
 */
export default async function CrewHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  const isMember = crew.my_status === "active";
  const today = todayISOIn(tz);
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 60);
  const supabase = await createClient();

  // 게시판 미리보기 · 다가오는 모임(오늘부터 60일) · 회비(크루원만) — 서로 독립이라 한 번에
  const [posts, { data: calRows }, duesRes, chargeRes] = await Promise.all([
    getCrewBoard(slug, null, 5),
    supabase.rpc("crew_calendar", { p_slug: slug, p_from: today, p_to: horizon.toISOString().slice(0, 10) }),
    // 회비 납부 링크 — RLS 가 본인 등급(전체/정회원/일반회원)에 해당하는 것만 내려준다.
    isMember
      ? supabase.from("crew_dues_links").select("id, label, url, amount, audience").eq("crew_id", crew.id).order("sort_order").order("created_at")
      : Promise.resolve({ data: null }),
    // 본인 회비 청구 — 월회비·회차비가 섞이므로 건별로 내려받는다
    isMember ? supabase.rpc("my_dues_charges", { p_slug: slug }) : Promise.resolve({ data: null }),
  ]);
  const duesLinks = (duesRes.data ?? []) as DuesLink[];
  const myCharges = (chargeRes.data ?? []) as MyCharge[];
  const next = ((calRows ?? []) as CalRow[])
    .filter((r) => r.kind === "meetup" && !r.closed)
    .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))[0];

  const links = crew.links ?? {};
  // 링크 — 사진첩·계좌는 크루원에게만 (공유 앨범 URL 과 계좌는 그 자체가 접근 권한이다)
  const linkCards: { label: string; href: string }[] = [];
  if (links.official) linkCards.push({ label: t("crew.official"), href: links.official });
  if (links.photos && isMember) linkCards.push({ label: t("crew.photos"), href: links.photos });

  // 미납 = 확정·면제되지 않은 청구
  const unpaid = myCharges.filter((c) => c.status === "pending" || c.status === "reported");
  const unpaidSum = unpaid.reduce((a, c) => a + c.amount, 0);
  const thisMonth = today.slice(0, 7);
  // 태그라인은 "hybrid, inbrxx, hyrox" 처럼 쉼표로 나열해 쓰고 있다 — 쪼개서 칩으로
  const tags = (crew.tagline ?? "")
    .split(/[,·]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const hours = [links.hours_weekday, links.hours_weekend].filter(Boolean).join(" · ");
  const notices = posts.filter((p) => p.category === "notice").slice(0, 2);
  const preview = notices.length ? notices : posts.slice(0, 2);
  const dateShort = (iso: string) => new Date(iso).toLocaleDateString(tag, { month: "short", day: "numeric", timeZone: tz });
  const nextAt = next?.starts_at ? new Date(next.starts_at) : null;
  const part = (opt: Intl.DateTimeFormatOptions) => (nextAt ? nextAt.toLocaleDateString(tag, { ...opt, timeZone: tz }) : "");
  const dayOnly = part({ day: "numeric" }).replace(/\D/g, "") || part({ day: "numeric" });

  return (
    <>
      <div className="rx-two-col">
        <Panel title={crew.tagline || crew.name}>
          {crew.description && (
            <p className="rx-lead" style={{ whiteSpace: "pre-line" }}>
              {crew.description}
            </p>
          )}
          {(crew.location || hours || links.phone) && (
            <div className="rx-info-grid">
              {crew.location && (
                <span>
                  <MapPin size={19} />
                  <b>{crew.location}</b>
                </span>
              )}
              {hours && (
                <span>
                  <CalendarDays size={19} />
                  <b>{hours}</b>
                </span>
              )}
              {links.phone && (
                <span>
                  <Phone size={19} />
                  <b>{links.phone}</b>
                </span>
              )}
            </div>
          )}
          {tags.length > 0 && (
            <div className="rx-actions">
              {tags.map((tag) => (
                <Chip key={tag}>{tag.toUpperCase()}</Chip>
              ))}
            </div>
          )}
          {linkCards.length > 0 && (
            <div className="rx-actions">
              {linkCards.map((l) => (
                <Button key={l.label} asChild variant="outline">
                  <a href={l.href} target="_blank" rel="noreferrer noopener">
                    {l.label} ↗
                  </a>
                </Button>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t("crew.upcomingMeetup")}>
          {next && nextAt ? (
            <div className="rx-crew-next">
              <span>
                {part({ month: "short" }).toUpperCase()}
                <strong>{dayOnly}</strong>
                {part({ weekday: "short" }).toUpperCase()}
              </span>
              <div>
                <h3>{next.title}</h3>
                <p>
                  {nextAt.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                  {next.subtitle ? ` · ${next.subtitle}` : ""}
                </p>
                <p>
                  {next.going_count ? t("crew.goingN", { n: next.going_count }) : t("crew.goingNone")}
                  {isMember && !next.my_status ? ` · ${t("crew.rsvpNone")}` : ""}
                </p>
                <Go href={`/crews/${slug}/schedule/${next.ref_id}`} primary>
                  {t("crew.rsvpCheck")} <ArrowRight size={16} />
                </Go>
              </div>
            </div>
          ) : (
            <Empty title={t("crew.noUpcoming")} description={t("crew.schedEmpty")} action={<Go href={`/crews/${slug}/schedule`}>{t("crew.schedTab")}</Go>} />
          )}
        </Panel>
      </div>

      <div className="rx-two-col">
        <Panel
          title={t("crew.noticeTitle")}
          action={
            <Link href={`/crews/${slug}/board`}>
              {t("crew.viewAll")} <ArrowRight size={16} />
            </Link>
          }
        >
          {preview.length ? (
            preview.map((p) => (
              <RecordRow
                key={p.id}
                href={`/crews/${slug}/board/${p.id}`}
                title={p.title}
                note={`${t(`crew.cat.${p.category}` as DictKey)} · ${p.author_name} · ${dateShort(p.created_at)}`}
              />
            ))
          ) : (
            <Empty title={t("crew.emptyBoard")} description={t("crew.writePostDesc")} />
          )}
        </Panel>
        <Panel title={t("crew.myDues")}>
          {isMember ? (
            <>
              <Chip tone={unpaid.length === 0 ? "green" : "yellow"}>{unpaid.length === 0 ? `✓ ${t("crew.noUnpaid")}` : t("crew.asOfMonth", { month: thisMonth })}</Chip>
              <div className="rx-summary-time">
                {unpaidSum.toLocaleString("ko-KR")}
                <small>원</small>
              </div>
              <p>{t("crew.finVisibilityRead")}</p>
              <Go href={`/crews/${slug}/finance?tab=dues`}>
                {t("crew.duesHistory")} <ArrowRight size={16} />
              </Go>
            </>
          ) : (
            <p className="rx-hint">{t("crew.memberOnly")}</p>
          )}
        </Panel>
      </div>

      {/* 회비 납부 — 청구가 있으면 링크가 없어도 보여준다 */}
      {isMember && (myCharges.length > 0 || duesLinks.length > 0) && (
        <Panel title={t("crew.duesPayTitle")} action={<span className="rx-muted">{t("crew.asOfMonth", { month: thisMonth })}</span>}>
          <CrewDuesSelfReport charges={myCharges} />
          {duesLinks.map((l) => (
            <div key={l.id} className="rx-record-row" style={{ cursor: "default" }}>
              <span>
                <b>{l.label}</b>
              </span>
              {l.amount != null && <strong>{won(l.amount)}</strong>}
              {l.url && (
                <Button asChild size="sm" className="rx-primary">
                  <a href={l.url} target="_blank" rel="noreferrer noopener">
                    {t("crew.duesPayBtn")}
                  </a>
                </Button>
              )}
            </div>
          ))}
          {links.bank_account && <CopyField label={t("crew.bankAccount")} value={links.bank_account} />}
        </Panel>
      )}

      {/* 운영 정책 — 크루원 전용 항목이 아니라 소개에 그대로 */}
      {links.policy && (
        <Panel title={t("crew.rulesTitle")}>
          <p style={{ whiteSpace: "pre-line" }}>{links.policy}</p>
        </Panel>
      )}
    </>
  );
}
