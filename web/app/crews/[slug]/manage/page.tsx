import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { tierBadgeClass } from "@/lib/crew-role";
import {
  CrewDeleteButton,
  CrewImageUpload,
  CrewInfoForm,
  CrewMemberManage,
  type ManageMember,
} from "@/components/crew-manage";
import {
  CrewProgramAttach,
  type AttachedProgram,
  type PickableProgram,
} from "@/components/crew-program-attach";
import {
  CrewDuesLinksManage,
  type DuesLink,
} from "@/components/crew-dues-links";
import { CrewTierManage, type CrewTier } from "@/components/crew-tier-manage";

const TABS = ["info", "members", "dues", "programs"] as const;
type Tab = (typeof TABS)[number];

type CrewStats = {
  members: number;
  pending: number;
  joined_30d: number;
  tiers: { name: string; color: string; count: number }[];
  meetups_30d: number;
  attend_30d: number;
  attenders_30d: number;
  trained_30d: number;
  unpaid_amount: number;
  unpaid_count: number;
};

/** 통계 타일 — 회계 탭과 같은 모양을 쓴다(숫자는 mono, 라벨은 muted). */
function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "accent" | "track" | "red";
}) {
  const cls =
    accent === "accent"
      ? "text-accent"
      : accent === "track"
        ? "text-track"
        : accent === "red"
          ? "text-red-400"
          : "";
  return (
    <div className="rounded-md bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${cls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export default async function CrewManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as Tab)
    : "info";

  const [crew, user, { t }] = await Promise.all([
    getCrew(slug),
    getCachedUser(),
    getT(),
  ]);
  if (!crew || !user) notFound();
  const myRole = crew.my_role;
  if (myRole !== "owner" && myRole !== "coach") notFound();

  const supabase = await createClient();
  // 어느 탭이든 필요한 것: 크루 행(정보 폼)·명단(대기 배지)·등급(멤버 등급 셀렉트)
  // 한 번에 — 탭에 필요 없는 조회는 건너뛴다
  const [
    { data: row },
    { data: roster },
    { data: tierRows },
    { data: statRow },
    { data: attachedRows },
    { data: progRows },
    { data: duesRows },
  ] = await Promise.all([
    supabase
      .from("crews")
      .select(
        "id, slug, name, tagline, description, location, links, logo_url, cover_url, join_policy, is_public",
      )
      .eq("slug", slug)
      .maybeSingle(),
    supabase.rpc("crew_manage_roster", { p_slug: slug }),
    supabase
      .from("crew_member_tiers")
      .select(
        "id, name, sort_order, color, is_full_member, monthly_fee, session_fee, is_default, archived_at",
      )
      .eq("crew_id", crew.id)
      .order("sort_order")
      .order("created_at"),
    tab === "members"
      ? supabase.rpc("crew_member_stats", { p_slug: slug })
      : Promise.resolve({ data: null }),
    tab === "programs"
      ? supabase
          .from("crew_program_enrollments")
          .select("program_id, start_date, end_date, repeat, programs ( title )")
          .eq("crew_id", crew.id)
          .order("start_date")
      : Promise.resolve({ data: null }),
    tab === "programs"
      ? supabase.from("programs").select("id, title").order("created_at")
      : Promise.resolve({ data: null }),
    tab === "dues"
      ? supabase
          .from("crew_dues_links")
          .select("id, label, url, amount, audience")
          .eq("crew_id", crew.id)
          .order("sort_order")
          .order("created_at")
      : Promise.resolve({ data: null }),
  ]);
  if (!row) notFound();

  const members = (roster ?? []) as ManageMember[];
  const tiers = (tierRows ?? []) as CrewTier[];
  const pendingCount = members.filter((m) => m.status === "pending").length;
  const stats = statRow as CrewStats | null;

  type AttachedRow = {
    program_id: string;
    start_date: string;
    end_date: string | null;
    repeat: boolean;
    programs: { title: string } | null;
  };
  const attached: AttachedProgram[] = (
    (attachedRows ?? []) as unknown as AttachedRow[]
  ).map((a) => ({
    program_id: a.program_id,
    start_date: a.start_date,
    end_date: a.end_date,
    repeat: a.repeat === true,
    title: a.programs?.title ?? "—",
  }));

  const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;
  const tabLabel: Record<Tab, string> = {
    info: t("crew.tabInfo"),
    members: t("crew.tabMembers"),
    dues: t("crew.tabDues"),
    programs: t("crew.tabPrograms"),
  };

  return (
    <main className="flex flex-col gap-8">
      {/* 관리 탭 — 크루 탭 바와 구분되게 알약형 */}
      <nav className="flex flex-wrap gap-1.5">
        {TABS.map((x) => (
          <Link
            key={x}
            href={`/crews/${slug}/manage?tab=${x}`}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm ${
              tab === x
                ? "bg-accent font-bold text-background"
                : "bg-surface text-muted hover:text-foreground"
            }`}
          >
            {tabLabel[x]}
            {x === "members" && pendingCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  tab === x ? "bg-background text-accent" : "bg-accent text-background"
                }`}
              >
                {pendingCount}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* ---------------- 크루 정보 ---------------- */}
      {tab === "info" && (
        <>
          <section>
            <h2 className="text-lg font-semibold">{t("crew.logoTitle")}</h2>
            <div className="mt-3">
              <CrewImageUpload crewId={crew.id} url={row.logo_url} kind="logo" />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">{t("crew.coverTitle")}</h2>
            <div className="mt-3">
              <CrewImageUpload crewId={crew.id} url={row.cover_url} kind="cover" />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">{t("crew.manageInfo")}</h2>
            <div className="mt-3 max-w-lg">
              <CrewInfoForm crew={row} />
            </div>
          </section>

          {myRole === "owner" && (
            <section>
              <h2 className="text-lg font-semibold text-red-400">
                {t("crew.dangerZone")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("crew.deleteCrewDesc")}</p>
              <div className="mt-3">
                <CrewDeleteButton crewId={crew.id} />
              </div>
            </section>
          )}
        </>
      )}

      {/* ---------------- 크루원 ---------------- */}
      {tab === "members" && (
        <>
          {pendingCount > 0 && (
            <a
              href="#members"
              className="flex items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm hover:bg-accent/15"
            >
              <span className="font-semibold text-accent">
                {t("crew.pendingAlert", { n: pendingCount })}
              </span>
              <span className="text-xs text-muted">{t("crew.pendingAlertGo")}</span>
            </a>
          )}

          {stats && (
            <section>
              <h2 className="text-lg font-semibold">{t("crew.statsTitle")}</h2>
              <p className="mt-1 text-xs text-muted">{t("crew.statsWindow")}</p>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label={t("crew.statMembers")}
                  value={String(stats.members)}
                  sub={t("crew.statJoined", { n: stats.joined_30d })}
                />
                <Stat
                  label={t("crew.statAttend")}
                  value={String(stats.attend_30d)}
                  sub={t("crew.statAttenders", {
                    n: stats.attenders_30d,
                    m: stats.meetups_30d,
                  })}
                  accent="accent"
                />
                <Stat
                  label={t("crew.statTrained")}
                  value={`${stats.trained_30d}/${stats.members}`}
                  sub={t("crew.statTrainedSub")}
                  accent="track"
                />
                <Stat
                  label={t("crew.statUnpaid")}
                  value={won(stats.unpaid_amount)}
                  sub={t("crew.statUnpaidSub", { n: stats.unpaid_count })}
                  accent={stats.unpaid_amount > 0 ? "red" : undefined}
                />
              </div>

              {/* 등급 분포 — 색만으로 구분하지 않도록 이름·숫자를 함께 적는다 */}
              {stats.tiers.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {stats.tiers.map((x) => {
                    const pct = stats.members
                      ? Math.round((x.count / stats.members) * 100)
                      : 0;
                    return (
                      <li
                        key={x.name}
                        className="flex items-center gap-3 rounded-md bg-surface px-4 py-2.5"
                      >
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${tierBadgeClass(
                            x.color,
                          )}`}
                        >
                          {x.name}
                        </span>
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background">
                          <span
                            className="block h-full rounded-full bg-muted/60"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="w-16 shrink-0 text-right font-mono text-xs text-muted">
                          {x.count}
                          <span className="ml-1 text-[10px]">({pct}%)</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <section id="members" className="scroll-mt-6">
            <h2 className="text-lg font-semibold">{t("crew.manageMembers")}</h2>
            <div className="mt-3">
              <CrewMemberManage
                slug={slug}
                crewId={crew.id}
                myRole={myRole}
                myUserId={user.id}
                members={members}
                tiers={tiers}
              />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">{t("crew.tierTitle")}</h2>
            <div className="mt-3 max-w-2xl">
              <CrewTierManage crewId={crew.id} tiers={tiers} />
            </div>
          </section>
        </>
      )}

      {/* ---------------- 회비 ---------------- */}
      {tab === "dues" && (
        <>
          <section>
            <h2 className="text-lg font-semibold">{t("crew.duesFeeTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("crew.duesFeeDesc")}</p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {tiers
                .filter((x) => !x.archived_at)
                .map((x) => (
                  <li
                    key={x.id}
                    className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-4 py-2.5"
                  >
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${tierBadgeClass(
                        x.color,
                      )}`}
                    >
                      {x.name}
                    </span>
                    <span className="ml-auto font-mono text-xs text-muted">
                      {t("crew.tierMonthly")}{" "}
                      {x.monthly_fee == null ? "—" : won(x.monthly_fee)} ·{" "}
                      {t("crew.tierSession")}{" "}
                      {x.session_fee == null ? "—" : won(x.session_fee)}
                    </span>
                  </li>
                ))}
            </ul>
            <Link
              href={`/crews/${slug}/manage?tab=members`}
              className="mt-3 inline-block text-xs text-accent hover:underline"
            >
              {t("crew.duesFeeEdit")}
            </Link>
          </section>

          <section>
            <h2 className="text-lg font-semibold">{t("crew.duesTitle")}</h2>
            <div className="mt-3 max-w-lg">
              <CrewDuesLinksManage
                crewId={crew.id}
                items={(duesRows ?? []) as DuesLink[]}
              />
            </div>
          </section>
        </>
      )}

      {/* ---------------- 프로그램 ---------------- */}
      {tab === "programs" && (
        <section>
          <h2 className="text-lg font-semibold">{t("crew.progAttach")}</h2>
          <div className="mt-3">
            <CrewProgramAttach
              crewId={crew.id}
              attached={attached}
              programs={(progRows ?? []) as PickableProgram[]}
            />
          </div>
        </section>
      )}
    </main>
  );
}
