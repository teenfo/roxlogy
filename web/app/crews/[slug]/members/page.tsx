import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew, getCrewRoster } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import {
  crewRoleBadgeClass,
  crewRoleDictKey,
  isStaffRole,
  tierBadgeClass,
} from "@/lib/crew-role";
import { Avatar, Card, Chip, ProgressBar } from "@/components/ui/crew-ui";

export default async function CrewMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tier?: string }>;
}) {
  const { slug } = await params;
  const { tier } = await searchParams;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();
  const roster = await getCrewRoster(slug);
  // 출석 횟수는 크루원에게만 내려온다 (crew_roster 가 비회원에게는 null)
  const showAttend = roster.some((m) => m.attend_count != null);

  if (!roster.length)
    return (
      <Card className="px-4 py-10 text-center">
        <p className="text-sm text-muted">{t("crew.emptyRoster")}</p>
      </Card>
    );

  // 등급 칩 — 운영진은 권한 뱃지를 쓰므로 별도 묶음으로 센다
  const STAFF = "__staff__";
  const tierCounts = new Map<string, number>();
  for (const m of roster) {
    const key = isStaffRole(m.role) ? STAFF : (m.tier_name ?? "—");
    tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1);
  }
  const shown = roster.filter((m) => {
    if (!tier) return true;
    return tier === STAFF
      ? isStaffRole(m.role)
      : !isStaffRole(m.role) && (m.tier_name ?? "—") === tier;
  });
  const chipHref = (v: string | null) =>
    v ? `/crews/${slug}/members?tier=${encodeURIComponent(v)}` : `/crews/${slug}/members`;

  return (
    <main>
      {/* 등급 필터 + 안내 */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={chipHref(null)} active={!tier} count={roster.length}>
          {t("crew.all")}
        </Chip>
        {[...tierCounts].map(([key, n]) => (
          <Chip
            key={key}
            href={chipHref(key)}
            active={tier === key}
            count={n}
          >
            {key === STAFF ? t("crew.staff") : key}
          </Chip>
        ))}
        {showAttend && (
          <span className="ml-auto shrink-0 text-xs text-muted">
            {t("crew.attendColHint")}
          </span>
        )}
      </div>

      <Card className="mt-5 overflow-hidden">
        {/* 헤더 */}
        <div className="grid grid-cols-[minmax(0,1fr)_90px_70px] items-center gap-3 border-b border-line px-5 py-2.5 text-xs text-muted sm:grid-cols-[minmax(0,1fr)_90px_70px_150px]">
          <span>{t("crew.roster")}</span>
          <span>{t("crew.tierLabel")}</span>
          <span className="text-right">{t("crew.colSessions")}</span>
          {showAttend && (
            <span className="hidden text-right sm:block">
              {t("crew.colAttend")}
            </span>
          )}
        </div>
        <ul className="divide-y divide-line">
          {shown.map((m) => (
            <li
              key={m.user_id}
              className="grid grid-cols-[minmax(0,1fr)_90px_70px] items-center gap-3 px-5 py-3 transition-colors hover:bg-card-hover sm:grid-cols-[minmax(0,1fr)_90px_70px_150px]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={m.display_name} />
                <span className="min-w-0">
                  <Link
                    href={`/u/${m.user_id}`}
                    className="block truncate text-[15px] font-bold hover:text-accent"
                  >
                    {m.display_name}
                  </Link>
                  {/* 계정 주소는 운영진에게만 내려온다 (동명이인·이름 미설정 구분용) */}
                  <span className="block truncate text-xs text-muted">
                    {m.email ? `${m.email} · ` : ""}
                    {formatDateShort(m.joined_at, tag, tz)}
                  </span>
                </span>
              </span>

              {/* 리더·부리더는 권한 뱃지, 나머지는 크루가 만든 등급 뱃지 */}
              <span>
                {isStaffRole(m.role) ? (
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${crewRoleBadgeClass(m.role)}`}
                  >
                    {t(crewRoleDictKey(m.role))}
                  </span>
                ) : (
                  m.tier_name && (
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${tierBadgeClass(m.tier_color)}`}
                    >
                      {m.tier_name}
                    </span>
                  )
                )}
              </span>

              <span
                className={`tabular text-right text-[15px] font-bold ${m.session_count ? "" : "text-muted/60"}`}
              >
                {m.session_count}
              </span>

              {showAttend && (
                /* 유료 / 전체 — 무료 행사가 섞이면 회비가 걸린 참석이 몇 번인지
                   한 숫자로는 알 수 없다 */
                <span className="hidden sm:block">
                  <ProgressBar
                    value={m.attend_paid_count ?? 0}
                    total={m.attend_count ?? 0}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
