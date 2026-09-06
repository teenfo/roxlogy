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

export default async function CrewMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();
  const roster = await getCrewRoster(slug);
  // 출석 횟수는 크루원에게만 내려온다 (crew_roster 가 비회원에게는 null)
  const showAttend = roster.some((m) => m.attend_count != null);

  if (!roster.length)
    return (
      <p className="rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
        {t("crew.emptyRoster")}
      </p>
    );

  return (
    <main>
      {/* 오른쪽 숫자 열이 뭔지 알 수 있게 머리글 */}
      <div className="flex items-center gap-3 px-4 pb-1.5 text-[10px] font-semibold tracking-wide text-muted">
        <span className="min-w-0 flex-1" />
        <span className="w-12 shrink-0 text-right">{t("crew.colSessions")}</span>
        {showAttend && (
          <span className="w-12 shrink-0 text-right">{t("crew.colAttend")}</span>
        )}
      </div>
      <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-muted/20">
        {roster.map((m) => (
          <li
            key={m.user_id}
            className="flex items-center gap-3 bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/u/${m.user_id}`}
                className="block truncate text-sm font-semibold hover:text-accent"
              >
                {m.display_name}
              </Link>
              <p className="mt-0.5 text-[11px] text-muted">
                {m.division?.replace("_", " ").toUpperCase() ?? "—"} ·{" "}
                {formatDateShort(m.joined_at, tag, tz)}
              </p>
            </div>
            {/* 리더·부리더는 권한 뱃지, 나머지는 크루가 만든 등급 뱃지 */}
            {isStaffRole(m.role) ? (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${crewRoleBadgeClass(
                  m.role,
                )}`}
              >
                {t(crewRoleDictKey(m.role))}
              </span>
            ) : (
              m.tier_name && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tierBadgeClass(
                    m.tier_color,
                  )}`}
                >
                  {m.tier_name}
                </span>
              )
            )}
            <span className="w-12 shrink-0 text-right font-mono text-sm text-muted">
              {m.session_count}
            </span>
            {showAttend && (
              <span
                className={`w-12 shrink-0 text-right font-mono text-sm ${
                  (m.attend_count ?? 0) > 0 ? "text-accent" : "text-muted"
                }`}
              >
                {m.attend_count ?? 0}
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
