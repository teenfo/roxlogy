import Link from "next/link";
import { notFound } from "next/navigation";
import { Settings } from "lucide-react";
import { getCrew } from "@/lib/crew";
import { crewInitials, isCrewStaff, isFullMember } from "@/lib/crew-types";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { CrewJoinButton } from "@/components/crew-join-button";
import { CrewCover } from "@/components/crew-cover";
import { Shell } from "@/components/rox/shell";
import { CrewNavTabs } from "@/components/rox/crew-nav-tabs";
import { Chip, Go } from "@/components/rox/ui";

/**
 * 크루 라우트 공용 레이아웃 — 시안 crew.tsx 의 Crew(): .rx-crew-header + NavTabs 7.
 * (app) 밖이라(공유 링크·비로그인 열람) Shell 이 세션으로 앱 셸/공개 헤더를 가른다.
 *
 * 시안에 없는 것(캡쳐 보고 대상, PORT_PLAN §4): 커버 이미지, 가입 버튼, 승인 대기 배지,
 * 관리 탭의 대기 신청 수. 탭은 권한에 따라 회계(정회원)·관리(운영진)만 붙는다.
 */
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

  const base = `/crews/${slug}`;
  const member = crew.my_status === "active" && !!crew.my_role;
  const staff = member && isCrewStaff(crew.my_role!);
  const tabs: [string, string][] = [
    [t("crew.aboutTab"), base],
    [t("crew.schedTab"), `${base}/schedule`],
    [t("crew.board"), `${base}/board`],
    [t("crew.leaderboard"), `${base}/leaderboard`],
    [t("crew.roster"), `${base}/members`],
  ];
  // 회계는 정회원 전용 (일반회원 associate 제외 — 재정은 비공개 정보)
  if (member && isFullMember(crew.my_role!)) {
    tabs.push([t("crew.financeTab"), `${base}/finance`]);
  }
  // 스태프(리더·부리더)에게만 관리 탭 — 대기 중인 가입 신청은 숫자로 알린다
  let pending = 0;
  if (staff) {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("crew_members")
      .select("user_id", { count: "exact", head: true })
      .eq("crew_id", crew.id)
      .eq("status", "pending");
    pending = error ? 0 : (count ?? 0);
    tabs.push([
      pending > 0 ? `${t("crew.manage")} ${pending}` : t("crew.manage"),
      `${base}/manage`,
    ]);
  }

  const meta = [crew.location, crew.home_gym].filter(Boolean).join(" · ");
  const sub = [`${crew.member_count} ${t("crew.members")}`, crew.tagline]
    .filter(Boolean)
    .join(" · ");

  return (
    <Shell loginNext={base}>
      {crew.cover_url && <CrewCover src={crew.cover_url} slug={slug} />}
      <div className="rx-crew-header">
        <Link className="rx-crew-mark" href={base}>
          {crew.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={crew.logo_url} alt="" />
          ) : (
            crewInitials(crew.name)
          )}
        </Link>
        <div>
          <h1>
            {crew.name}{" "}
            {member && <Chip tone="green">{t("crew.joinedBadge")}</Chip>}
            {crew.crew_status === "pending" && (
              <Chip tone="yellow">{t("crew.pendingBadge")}</Chip>
            )}
          </h1>
          <p>
            {meta}
            {meta && sub ? " " : ""}
            {sub && <span>{sub}</span>}
          </p>
        </div>
        {staff ? (
          <Go href={`${base}/manage`}>
            <Settings size={16} />
            {t("crew.manage")}
          </Go>
        ) : crew.crew_status === "active" ? (
          <div className="ml-auto">
            <CrewJoinButton
              slug={slug}
              status={crew.my_status}
              role={crew.my_role}
              loggedIn={!!user}
            />
          </div>
        ) : (
          <p className="ml-auto max-w-48 text-xs text-muted-foreground">
            {t("crew.pendingNote")}
          </p>
        )}
      </div>
      <CrewNavTabs items={tabs} />
      {children}
    </Shell>
  );
}
