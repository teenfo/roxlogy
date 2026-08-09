import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { CrewJoinButton } from "@/components/crew-join-button";
import { LocaleSwitcher } from "@/components/locale-switcher";

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
    { href: `/crews/${slug}/board`, label: t("crew.board") },
    { href: `/crews/${slug}/schedule`, label: t("crew.schedule") },
    { href: `/crews/${slug}/leaderboard`, label: t("crew.leaderboard") },
    { href: `/crews/${slug}/members`, label: t("crew.roster") },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-surface bg-background">
        <nav className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={24} height={24} />
            <span className="text-xs font-black tracking-widest text-muted">
              ROXLOGY
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <LocaleSwitcher />
            {user ? (
              <Link
                href="/dashboard"
                className="text-sm text-muted hover:text-foreground"
              >
                {t("nav.dashboard")}
              </Link>
            ) : (
              <Link
                href={`/login?next=/crews/${slug}`}
                className="text-sm text-muted hover:text-foreground"
              >
                {t("common.login")}
              </Link>
            )}
          </div>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {/* 크루 헤더 */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-black tracking-tight">{crew.name}</h1>
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
              <span>
                <b className="text-foreground">{crew.upcoming_count}</b>{" "}
                {t("crew.upcoming")}
              </span>
            </p>
          </div>
          <CrewJoinButton
            slug={slug}
            status={crew.my_status}
            loggedIn={!!user}
          />
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
