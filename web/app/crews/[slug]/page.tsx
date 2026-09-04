import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew, getCrewBoard } from "@/lib/crew";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { DuesLink } from "@/components/crew-dues-links";
import {
  CrewDuesSelfReport,
  type DuesPaymentStatus,
} from "@/components/crew-dues-check";
import { getCachedUser } from "@/lib/supabase/auth";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

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
  const [crew, { t }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  const posts = await getCrewBoard(slug, null, 5);

  // 회비 납부 링크 — RLS 가 본인 등급(전체/정회원/일반회원)에 해당하는 것만 내려준다.
  // 비회원에게는 아무것도 반환되지 않으므로 크루원일 때만 조회.
  let duesLinks: DuesLink[] = [];
  // 이번 달(KST) 본인 납부 상태 — 셀프 신고 블록용
  const period = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  }).slice(0, 7);
  let myDues: DuesPaymentStatus = null;
  if (crew.my_status === "active") {
    const supabase = await createClient();
    const user = await getCachedUser();
    const [{ data }, { data: payRow }] = await Promise.all([
      supabase
        .from("crew_dues_links")
        .select("id, label, url, amount, audience")
        .eq("crew_id", crew.id)
        .order("sort_order")
        .order("created_at"),
      user
        ? supabase
            .from("crew_dues_payments")
            .select("status")
            .eq("crew_id", crew.id)
            .eq("user_id", user.id)
            .eq("period", period)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    duesLinks = (data ?? []) as DuesLink[];
    myDues = (payRow?.status ?? null) as DuesPaymentStatus;
  }

  const links = crew.links ?? {};
  const info: { label: string; value: string; href?: string }[] = [];
  if (crew.location)
    info.push({ label: t("crew.location"), value: crew.location });
  if (links.hours_weekday || links.hours_weekend)
    info.push({
      label: t("crew.hours"),
      value: [links.hours_weekday, links.hours_weekend]
        .filter(Boolean)
        .join(" · "),
    });
  if (links.phone) info.push({ label: t("crew.contact"), value: links.phone });
  if (links.official)
    info.push({
      label: t("crew.official"),
      value: links.official,
      href: links.official,
    });
  // 사진첩은 크루원에게만 노출 — 공유 앨범 URL 은 그 자체가 접근 권한이라
  // 공개 소개 페이지(비회원도 봄)에 걸면 되돌릴 수 없다.
  if (links.photos && crew.my_status === "active")
    info.push({
      label: t("crew.photos"),
      value: links.photos,
      href: links.photos,
    });
  // 회비 계좌는 크루원에게만 노출 (공개 소개 페이지는 비회원도 보므로)
  if (links.bank_account && crew.my_status === "active")
    info.push({ label: t("crew.bankAccount"), value: links.bank_account });

  return (
    <main className="flex flex-col gap-8">
      {crew.description && (
        <section>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {crew.description}
          </p>
        </section>
      )}

      {!!info.length && (
        <section className="grid gap-px overflow-hidden rounded-md bg-muted/20 sm:grid-cols-2">
          {info.map((row) => (
            <div key={row.label} className="bg-surface px-4 py-3">
              <p className="text-[11px] tracking-wide text-muted">{row.label}</p>
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-0.5 block truncate text-sm text-accent hover:underline"
                >
                  {row.value}
                </a>
              ) : (
                <p className="mt-0.5 text-sm">{row.value}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 회비 납부 링크 — 본인 등급에 해당하는 링크만 (RLS) */}
      {duesLinks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">{t("crew.duesPayTitle")}</h2>
          {/* 이번 달 본인 납부 상태 + 셀프 신고 */}
          <div className="mt-3">
            <CrewDuesSelfReport
              crewId={crew.id}
              period={period}
              status={myDues}
            />
          </div>
          <ul className="mt-3 flex flex-col gap-1.5">
            {duesLinks.map((l) => (
              <li
                key={l.id}
                className="flex min-w-0 items-center gap-3 rounded-md bg-surface px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {l.label}
                </span>
                {l.amount != null && (
                  <span className="shrink-0 font-mono text-sm font-bold text-track">
                    ₩{l.amount.toLocaleString("ko-KR")}
                  </span>
                )}
                {l.url && (
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 rounded-md bg-accent px-4 py-1.5 text-xs font-bold text-background hover:brightness-110"
                  >
                    {t("crew.duesPayBtn")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 운영 정책 */}
      {links.policy && (
        <section>
          <h2 className="text-lg font-semibold">{t("crew.rulesTitle")}</h2>
          <p className="mt-3 whitespace-pre-line rounded-md bg-surface px-4 py-4 text-sm leading-relaxed text-foreground/90">
            {links.policy}
          </p>
        </section>
      )}

      {/* 최근 글 */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{t("crew.board")}</h2>
          <Link
            href={`/crews/${slug}/board`}
            className="text-xs text-muted hover:text-accent"
          >
            {t("crew.viewAll")} →
          </Link>
        </div>
        {!posts.length ? (
          <p className="mt-3 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
            {t("crew.emptyBoard")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {posts.map((p) => (
              <li key={p.id} className="rounded-md bg-surface px-4 py-3">
                <Link
                  href={`/crews/${slug}/board/${p.id}`}
                  className="flex items-center gap-2"
                >
                  <span className="shrink-0 rounded-full border border-muted/40 px-2 py-0.5 text-[10px] text-muted">
                    {t(`crew.cat.${p.category}` as DictKey)}
                  </span>
                  {p.members_only && (
                    <span className="shrink-0 rounded-full bg-track/15 px-2 py-0.5 text-[10px] font-bold text-track">
                      {t("crew.fullOnly")}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-accent">
                    {p.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {p.author_name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
