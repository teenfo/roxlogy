import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { CrewJoinButton } from "@/components/crew-join-button";
import { CrewHeader } from "@/components/crew-header";

export default async function CrewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [crew, user, { t }] = await Promise.all([
    getCrew(slug),
    getCachedUser(),
    getT(),
  ]);
  if (!crew) notFound();

  const tabs = [
    { href: `/crews/${slug}`, label: t("crew.about") },
    { href: `/crews/${slug}/schedule`, label: t("crew.schedTab") },
    { href: `/crews/${slug}/board`, label: t("crew.board") },
    { href: `/crews/${slug}/leaderboard`, label: t("crew.leaderboard") },
    { href: `/crews/${slug}/members`, label: t("crew.roster") },
  ];
  // 회계는 정회원 전용 (일반회원 associate 제외 — 재정은 비공개 정보)
  if (crew.my_status === "active" && crew.my_role !== "associate") {
    tabs.push({ href: `/crews/${slug}/finance`, label: t("crew.financeTab") });
  }
  // 스태프(리더·부리더)에게만 관리 탭 노출
  if (crew.my_role === "owner" || crew.my_role === "coach") {
    tabs.push({ href: `/crews/${slug}/manage`, label: t("crew.manage") });
  }

  return (
    <>
      <CrewHeader loginNext={`/crews/${slug}`} />

      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {crew.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={crew.cover_url}
            alt=""
            className="mb-6 h-36 w-full rounded-md object-cover sm:h-52"
          />
        )}
        {/* 크루 헤더 */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            {crew.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={crew.logo_url}
                alt=""
                className="h-14 w-14 shrink-0 rounded-md object-cover"
              />
            )}
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-black tracking-tight">{crew.name}</h1>
              {crew.crew_status === "pending" && (
                <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">
                  {t("crew.pendingBadge")}
                </span>
              )}
            </div>
            {crew.tagline && (
              <p className="mt-1 text-sm font-semibold tracking-widest text-accent">
                {crew.tagline}
              </p>
            )}
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>
                <b className="text-foreground">{crew.member_count}</b>{" "}
                {t("crew.members")}
              </span>
              <span>
                <b className="text-foreground">{crew.post_count}</b>{" "}
                {t("crew.posts")}
              </span>
            </p>
            </div>
          </div>
          {crew.crew_status === "active" ? (
            <CrewJoinButton
              slug={slug}
              status={crew.my_status}
              role={crew.my_role}
              loggedIn={!!user}
            />
          ) : (
            <p className="max-w-48 text-xs text-muted">{t("crew.pendingNote")}</p>
          )}
        </div>

        {/* 탭 */}
        <div className="mt-6 flex gap-2 overflow-x-auto border-b border-surface pb-px">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="shrink-0 rounded-t-md px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              {tab.label}
            </Link>
          ))}
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </>
  );
}
