import { notFound } from "next/navigation";
import { getCrew, getCrewRoster } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { CrewLoginGate } from "@/components/crew-login-gate";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import { crewRoleChipTone, crewRoleDictKey, isStaffRole, tierChipTone } from "@/lib/crew-role";
import { QueryChoice } from "@/components/rox/query-filters";
import { Person } from "@/components/rox/person";
import { Chip, DataTable, Empty, Hint, Panel } from "@/components/rox/ui";

/**
 * 크루원 — 시안 crew.tsx MemberList 그대로 (PORT_PLAN §3-e):
 * .rx-subhead("함께하는 크루원 N" + Chip 구성) · Panel[ .rx-toolbar(Choice 등급) · DataTable[멤버 · 회원 구분 · 공유 세션] · Empty · Hint ].
 * 등급 필터는 서버 필터(?tier=)라 QueryChoice 로. 검색은 시안에 있지만 우리 목록은 한 페이지라 필터만 둔다.
 */
export default async function CrewMembersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tier?: string }> }) {
  const { slug } = await params;
  const { tier } = await searchParams;
  const [crew, user, { t, tag, tz }] = await Promise.all([getCrew(slug), getCachedUser(), getT()]);
  if (!crew) notFound();
  // 멤버 목록은 로그인 후에만 — crew_roster 도 같은 조건으로 막혀 있다
  if (!user) return <CrewLoginGate next={`/crews/${slug}/members`} />;
  const roster = await getCrewRoster(slug);

  // 등급 구성 — 운영진은 권한 칩을 쓰므로 별도 묶음으로 센다
  const STAFF = "__staff__";
  const tierCounts = new Map<string, number>();
  for (const m of roster) {
    const key = isStaffRole(m.role) ? STAFF : (m.tier_name ?? "—");
    tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1);
  }
  const shown = roster.filter((m) => {
    if (!tier) return true;
    return tier === STAFF ? isStaffRole(m.role) : !isStaffRole(m.role) && (m.tier_name ?? "—") === tier;
  });
  const composition = [...tierCounts].map(([key, n]) => `${key === STAFF ? t("crew.staff") : key} ${n}`).join(" · ");

  return (
    <>
      <div className="rx-subhead">
        <h2>
          {t("crew.membersTitle")} <span className="rx-muted">{roster.length}</span>
        </h2>
        {composition && <Chip>{composition}</Chip>}
      </div>
      <Panel>
        <div className="rx-toolbar">
          <span className="rx-muted">{t("crew.roster")}</span>
          <QueryChoice
            label={t("crew.tierFilter")}
            param="tier"
            value={tier ?? "all"}
            options={[["all", t("crew.all")], ...[...tierCounts.keys()].map((key) => [key, key === STAFF ? t("crew.staff") : key] as [string, string])]}
          />
        </div>
        {shown.length ? (
          <DataTable
            headers={[t("crew.colMember"), t("crew.tierFilter"), t("crew.colSharedSessions")]}
            rows={shown.map((m) => [
              // 계정 주소는 운영진에게만 내려온다 (동명이인·이름 미설정 구분용)
              <Person key="p" name={m.display_name} note={`${m.email ? `${m.email} · ` : ""}${formatDateShort(m.joined_at, tag, tz)}`} />,
              // 리더·부리더는 권한 칩, 나머지는 크루가 만든 등급 칩
              isStaffRole(m.role) ? (
                <Chip key="r" tone={crewRoleChipTone(m.role)}>
                  {t(crewRoleDictKey(m.role))}
                </Chip>
              ) : m.tier_name ? (
                <Chip key="r" tone={tierChipTone(m.tier_color)}>
                  {m.tier_name}
                </Chip>
              ) : (
                <span key="r">—</span>
              ),
              <strong key="s" className="rx-number">
                {m.session_count}
              </strong>,
            ])}
          />
        ) : (
          <Empty title={t("crew.emptyRoster")} description={t("crew.memberNoteHint")} />
        )}
        <Hint>{t("crew.memberNoteHint")}</Hint>
      </Panel>
    </>
  );
}
