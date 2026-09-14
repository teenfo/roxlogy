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
import {
  CrewTierFees,
  CrewTierManage,
  type CrewTier,
  type TierCounts,
} from "@/components/crew-tier-manage";
import { Card, Chip } from "@/components/ui/crew-ui";
import {
  CrewUnpaidCard,
  type UnpaidCharge,
} from "@/components/crew-unpaid-card";

const TABS = ["info", "members", "tiers", "dues", "programs"] as const;
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
  waived_amount: number;
  unpaid_list: UnpaidCharge[];
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
          ? "text-danger"
          : "";
  return (
    <Card className="px-4 py-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular mt-1 text-xl font-extrabold ${cls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
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
  /** 등급별 활동 회원 수 — 명단에서 세면 추가 조회가 없다(stats.tiers 는 이름만 있어
   *  같은 이름이 둘이면 붙일 수 없다) */
  const bankAccount =
    ((row.links ?? {}) as Record<string, string | null>).bank_account ?? "";
  const tierCounts: TierCounts = {};
  for (const m of members) {
    if (m.status !== "active" || !m.tier_id) continue;
    tierCounts[m.tier_id] = (tierCounts[m.tier_id] ?? 0) + 1;
  }
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

  const tabLabel: Record<Tab, string> = {
    info: t("crew.tabInfo"),
    members: t("crew.tabMembers"),
    tiers: t("crew.tierTitle"),
    dues: t("crew.tabDues"),
    programs: t("crew.tabPrograms"),
  };

  return (
    <main className="flex flex-col gap-8">
      {/* 관리 탭 — 크루 탭 바와 구분되게 알약형 */}
      <nav className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <Chip
            key={x}
            href={`/crews/${slug}/manage?tab=${x}`}
            active={tab === x}
            count={x === "members" && pendingCount > 0 ? pendingCount : undefined}
          >
            {tabLabel[x]}
          </Chip>
        ))}
      </nav>

      {/* ---------------- 크루 정보 ---------------- */}
      {tab === "info" && (
        <>
          <section>
            <h2 className="text-base font-extrabold">{t("crew.logoTitle")}</h2>
            <div className="mt-3">
              <CrewImageUpload crewId={crew.id} url={row.logo_url} kind="logo" />
            </div>
          </section>

          <section>
            <h2 className="text-base font-extrabold">{t("crew.coverTitle")}</h2>
            <div className="mt-3">
              <CrewImageUpload crewId={crew.id} url={row.cover_url} kind="cover" />
            </div>
          </section>

          <section>
            <h2 className="text-base font-extrabold">{t("crew.manageInfo")}</h2>
            <div className="mt-3 max-w-lg">
              <CrewInfoForm crew={row} />
            </div>
          </section>

          {myRole === "owner" && (
            <section className="rounded-2xl border border-danger-line bg-danger-card px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-extrabold text-danger">
                    {t("crew.dangerZone")}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted">
                    {t("crew.deleteCrewDesc")}
                  </p>
                </div>
                <div className="ml-auto shrink-0">
                  <CrewDeleteButton crewId={crew.id} />
                </div>
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
              <h2 className="text-base font-extrabold">{t("crew.statsTitle")}</h2>
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
                <CrewUnpaidCard
                  amount={stats.unpaid_amount}
                  count={stats.unpaid_count}
                  waived={stats.waived_amount}
                  charges={stats.unpaid_list ?? []}
                  financeHref={`/crews/${slug}/finance?tab=dues`}
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
                        className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-2.5"
                      >
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${tierBadgeClass(
                            x.color,
                          )}`}
                        >
                          {x.name}
                        </span>
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
                          <span
                            className="block h-full rounded-full bg-muted/60"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="tabular w-16 shrink-0 text-right text-xs text-muted">
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
            <h2 className="text-base font-extrabold">{t("crew.manageMembers")}</h2>
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

        </>
      )}

      {/* ---------------- 회원 등급 ---------------- */}
      {tab === "tiers" && (
        <section>
          <CrewTierManage crewId={crew.id} tiers={tiers} counts={tierCounts} />
        </section>
      )}

      {/* ---------------- 회비 ---------------- */}
      {tab === "dues" && (
        // 좌: 등급별 회비 + 계좌 / 우: 결제 링크. 좁으면 한 열로 떨어진다.
        <div className="grid items-start gap-4 min-[900px]:grid-cols-2">
          <div className="flex flex-col gap-3.5">
            <CrewTierFees
              crewId={crew.id}
              tiers={tiers}
              counts={tierCounts}
              tiersHref={`/crews/${slug}/manage?tab=tiers`}
            />
            {/* 회비 계좌는 크루 정보의 links.bank_account 한 곳에서 관리한다 —
                여기서는 무엇이 걸려 있는지 보여 주고 그리로 보낸다 */}
            <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-card px-[18px] py-3.5">
              <p className="text-xs text-muted">
                {t("crew.bankAccount")}
                <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-label-bg text-label">
                  {t("crew.membersOnlyBadge")}
                </span>
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 break-all text-sm font-semibold">
                  {bankAccount || <span className="text-[#666]">{t("crew.bankAccountNone")}</span>}
                </span>
                <Link
                  href={`/crews/${slug}/manage?tab=info`}
                  className="shrink-0 text-xs text-accent hover:underline"
                >
                  {t("crew.goInfoEdit")}
                </Link>
              </div>
            </div>
          </div>

          <CrewDuesLinksManage
            crewId={crew.id}
            items={(duesRows ?? []) as DuesLink[]}
          />
        </div>
      )}

      {/* ---------------- 프로그램 ---------------- */}
      {tab === "programs" && (
        <section>
          <h2 className="text-base font-extrabold">{t("crew.progAttach")}</h2>
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
