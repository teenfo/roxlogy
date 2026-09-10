import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew, getCrewBoard } from "@/lib/crew";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { DuesLink } from "@/components/crew-dues-links";
import {
  CrewDuesSelfReport,
  type MyCharge,
} from "@/components/crew-dues-check";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Badge, Card, SectionHead } from "@/components/ui/crew-ui";
import { CopyField } from "@/components/copy-field";
import { todayISOIn } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const crew = await getCrew(slug);
  if (!crew) return { title: "Crew" };
  return {
    title: `${crew.name} — ${crew.tagline ?? "Crew"}`,
    description: crew.description?.slice(0, 160),
  };
}

export default async function CrewHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [crew, { t, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  const posts = await getCrewBoard(slug, null, 5);

  // 회비 납부 링크 — RLS 가 본인 등급(전체/정회원/일반회원)에 해당하는 것만 내려준다.
  // 비회원에게는 아무것도 반환되지 않으므로 크루원일 때만 조회.
  let duesLinks: DuesLink[] = [];
  // 본인 회비 청구 — 월회비·회차비가 섞이므로 건별로 내려받는다
  let myCharges: MyCharge[] = [];
  if (crew.my_status === "active") {
    const supabase = await createClient();
    const [{ data }, { data: chargeRows }] = await Promise.all([
      supabase
        .from("crew_dues_links")
        .select("id, label, url, amount, audience")
        .eq("crew_id", crew.id)
        .order("sort_order")
        .order("created_at"),
      supabase.rpc("my_dues_charges", { p_slug: slug }),
    ]);
    duesLinks = (data ?? []) as DuesLink[];
    myCharges = (chargeRows ?? []) as MyCharge[];
  }

  const links = crew.links ?? {};

  // 정보 카드 — 위치·운영시간·문의 (아이콘 + 라벨 + 값)
  const info: { icon: string; label: string; value: string }[] = [];
  if (crew.location)
    info.push({ icon: "◎", label: t("crew.location"), value: crew.location });
  if (links.hours_weekday || links.hours_weekend)
    info.push({
      icon: "◷",
      label: t("crew.hours"),
      value: [links.hours_weekday, links.hours_weekend].filter(Boolean).join(" · "),
    });
  if (links.phone)
    info.push({ icon: "@", label: t("crew.contact"), value: links.phone });

  // 링크 카드 — 외부로 나가는 것들. 사진첩·계좌는 크루원에게만
  // (공유 앨범 URL 과 계좌는 그 자체가 접근 권한이라 공개 페이지에 걸면 되돌릴 수 없다)
  const isMember = crew.my_status === "active";
  const linkCards: { label: string; href: string }[] = [];
  if (links.official)
    linkCards.push({ label: t("crew.official"), href: links.official });
  if (links.photos && isMember)
    linkCards.push({ label: t("crew.photos"), href: links.photos });

  // 미납 = 확정·면제되지 않은 청구
  const unpaid = myCharges.filter(
    (c) => c.status === "pending" || c.status === "reported",
  );
  const thisMonth = todayISOIn(tz).slice(0, 7);
  const noticeCount = posts.filter((p) => p.category === "notice").length;
  // 태그라인은 "hybrid, inbrxx, hyrox" 처럼 쉼표로 나열해 쓰고 있다 — 쪼개서
  // 태그 뱃지로 보여준다.
  const tags = (crew.tagline ?? "")
    .split(/[,·]/)
    .map((x) => x.trim())
    .filter(Boolean);

  return (
    <main className="flex flex-col gap-5">
      {/* 소개 + 정보 — 좌 1.4 : 우 1 */}
      {(crew.description || tags.length > 0 || info.length > 0) && (
        <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          {(crew.description || tags.length > 0) && (
            <Card highlight className="px-6 py-5">
              <p className="text-[11px] font-extrabold tracking-[0.1em] text-accent">
                {t("crew.aboutLabel")}
              </p>
              {crew.description && (
                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-foreground/80">
                  {crew.description}
                </p>
              )}
              {/* 태그라인은 쉼표로 나눠 태그 뱃지로. 위치는 옆 정보 카드에
                  이미 있으므로 여기서는 빼 중복을 없앤다. */}
              {tags.length > 0 && (
                <span className="mt-4 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-label-bg px-2.5 py-1 text-xs font-semibold text-label"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </Card>
          )}

          {info.length > 0 && (
            <Card className="flex flex-col gap-4 px-6 py-5">
              {info.map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-line text-muted"
                  >
                    {row.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted">{row.label}</p>
                    <p className="truncate text-base font-bold">{row.value}</p>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>
      )}

      {/* 링크 · 계좌 */}
      {(linkCards.length > 0 || (links.bank_account && isMember)) && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {linkCards.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              className="flex flex-col gap-1 rounded-xl border border-line bg-card px-4 py-3.5 transition-colors hover:border-line-strong"
            >
              <span className="flex items-center gap-2 text-xs text-muted">
                {l.label}
                <span className="ml-auto text-[11px]">↗</span>
              </span>
              <span className="truncate text-[15px] font-bold text-accent">
                {l.href.replace(/^https?:\/\//, "")}
              </span>
            </a>
          ))}
          {links.bank_account && isMember && (
            <CopyField
              label={t("crew.bankAccount")}
              value={links.bank_account}
            />
          )}
        </section>
      )}

      {/* 회비 납부 — 청구가 있으면 링크가 없어도 보여준다 */}
      {(myCharges.length > 0 || duesLinks.length > 0) && (
        <section>
          <SectionHead
            title={t("crew.duesPayTitle")}
            badge={
              unpaid.length === 0 ? (
                <Badge tone="success">✓ {t("crew.noUnpaid")}</Badge>
              ) : (
                <Badge tone="danger">
                  ₩
                  {unpaid
                    .reduce((a, c) => a + c.amount, 0)
                    .toLocaleString("ko-KR")}
                </Badge>
              )
            }
            right={
              <span className="text-xs text-muted">
                {t("crew.asOfMonth", { month: thisMonth })}
              </span>
            }
          />
          <CrewDuesSelfReport charges={myCharges} />
          {duesLinks.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {duesLinks.map((l) => (
                <li
                  key={l.id}
                  className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-card px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                    {l.label}
                  </span>
                  {l.amount != null && (
                    <span className="tabular shrink-0 text-[15px] font-extrabold">
                      ₩{l.amount.toLocaleString("ko-KR")}
                    </span>
                  )}
                  {l.url && (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-background hover:brightness-110"
                    >
                      {t("crew.duesPayBtn")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 운영 정책 */}
      {links.policy && (
        <section>
          <SectionHead title={t("crew.rulesTitle")} />
          <Card className="px-5 py-4">
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/80">
              {links.policy}
            </p>
          </Card>
        </section>
      )}

      {/* 게시판 미리보기 */}
      <section>
        <SectionHead
          title={t("crew.board")}
          badge={
            noticeCount > 0 ? (
              <Badge tone="accent">
                {t("crew.noticeCount", { n: noticeCount })}
              </Badge>
            ) : undefined
          }
          right={
            <Link
              href={`/crews/${slug}/board`}
              className="text-[13px] text-muted hover:text-accent"
            >
              {t("crew.viewAll")} →
            </Link>
          }
        />
        {!posts.length ? (
          <Card className="px-4 py-10 text-center">
            <p className="text-sm text-muted">{t("crew.emptyBoard")}</p>
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {posts.map((p) => (
              <Link
                key={p.id}
                href={`/crews/${slug}/board/${p.id}`}
                className="flex items-center gap-2.5 px-5 py-3.5 transition-colors hover:bg-card-hover"
              >
                {p.category === "notice" ? (
                  <Badge outline>{t("crew.cat.notice" as DictKey)}</Badge>
                ) : (
                  <Badge tone="neutral">
                    {t(`crew.cat.${p.category}` as DictKey)}
                  </Badge>
                )}
                {p.members_only && (
                  <Badge tone="label">{t("crew.fullOnly")}</Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                  {p.title}
                </span>
                <span className="shrink-0 text-[13px] text-muted">
                  {p.author_name}
                </span>
                <span aria-hidden className="shrink-0 text-muted">
                  ›
                </span>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </main>
  );
}
