import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { CrewJoinButton } from "@/components/crew-join-button";
import { CrewHeader } from "@/components/crew-header";
import { CrewTabs } from "@/components/crew-tabs";
import { CrewCover } from "@/components/crew-cover";

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

  // 소개는 탭에서 빼고 크루명 링크로 옮겼다 — 탭이 7개면 모바일에서 가로
  // 스크롤이 생겨 뒤쪽 탭(회계·관리)이 화면 밖에 숨는다.
  const tabs: { href: string; label: string; badge?: number }[] = [
    { href: `/crews/${slug}/schedule`, label: t("crew.schedTab") },
    { href: `/crews/${slug}/board`, label: t("crew.board") },
    { href: `/crews/${slug}/leaderboard`, label: t("crew.leaderboard") },
    { href: `/crews/${slug}/members`, label: t("crew.roster") },
  ];
  // 회계는 정회원 전용 (일반회원 associate 제외 — 재정은 비공개 정보)
  if (crew.my_status === "active" && crew.my_role !== "associate") {
    tabs.push({ href: `/crews/${slug}/finance`, label: t("crew.financeTab") });
  }
  // 스태프(리더·부리더)에게만 관리 탭 노출 — 대기 중인 가입 신청은 배지로 알린다
  // (신청이 들어온 걸 관리 탭에 들어가야만 알 수 있던 문제).
  if (crew.my_role === "owner" || crew.my_role === "coach") {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("crew_members")
      .select("user_id", { count: "exact", head: true })
      .eq("crew_id", crew.id)
      .eq("status", "pending");
    tabs.push({
      href: `/crews/${slug}/manage`,
      label: t("crew.manage"),
      badge: error ? 0 : (count ?? 0),
    });
  }

  return (
    <>
      <CrewHeader loginNext={`/crews/${slug}`} />

      <div className="mx-auto w-full max-w-[960px] flex-1 px-6 py-8 max-md:px-4 max-md:pb-28">
        {/* 커버는 탭 화면에서만 — 모임 상세·게시글에서는 본문이 먼저다 */}
        {crew.cover_url && <CrewCover src={crew.cover_url} slug={slug} />}
        {/* 크루 헤더 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {crew.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={crew.logo_url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-md object-cover sm:h-14 sm:w-14"
              />
            )}
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-2xl font-black tracking-tight sm:text-3xl">
                {/* 크루명 = 소개로 가는 링크 (소개 탭을 대신한다) */}
                <Link href={`/crews/${slug}`} className="hover:text-accent">
                  {crew.name}
                </Link>
              </h1>
              {crew.crew_status === "pending" && (
                <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">
                  {t("crew.pendingBadge")}
                </span>
              )}
            </div>
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
          <div className="shrink-0">
            {crew.crew_status === "active" ? (
              <CrewJoinButton
                slug={slug}
                status={crew.my_status}
                role={crew.my_role}
                loggedIn={!!user}
              />
            ) : (
              <p className="max-w-48 text-xs text-muted">
                {t("crew.pendingNote")}
              </p>
            )}
          </div>
        </div>

        {/* 탭 — 활성 표시는 클라이언트에서 경로와 대조한다 */}
        <CrewTabs tabs={tabs} />

        <div className="mt-6">{children}</div>
      </div>
    </>
  );
}
