import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew, getCrewLeaderboard } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { CrewLoginGate } from "@/components/crew-login-gate";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShort } from "@/lib/format";
// 디비전 목록은 단일 출처를 쓴다 — 여기 하드코딩된 목록에 믹스 더블·믹스
// 릴레이가 빠져 있어 크루 리더보드에만 그 탭이 없었다.
import { DIVISIONS } from "@/lib/divisions";
import { Avatar, Badge, Card, Chip } from "@/components/ui/crew-ui";

export default async function CrewLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ division?: string }>;
}) {
  const { slug } = await params;
  const { division } = await searchParams;
  const div = (DIVISIONS as readonly string[]).includes(division ?? "") ? division! : null;

  const [crew, user, { t, tag, tz }] = await Promise.all([
    getCrew(slug),
    getCachedUser(),
    getT(),
  ]);
  if (!crew) notFound();
  // 기록 순위도 로그인 후에만 — crew_leaderboard 도 같은 조건으로 막혀 있다
  if (!user) return <CrewLoginGate next={`/crews/${slug}/leaderboard`} />;
  const rows = await getCrewLeaderboard(slug, div, 100);

  // 1위 대비 격차 — 아래 순위들이 얼마나 떨어져 있는지 바로 보이게
  const topMs = rows[0]?.best_ms ?? null;
  const gap = (ms: number | null) => {
    if (ms == null || topMs == null || ms <= topMs) return null;
    const d = Math.round((ms - topMs) / 1000);
    return `+${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
  };
  const rankStyle = (rank: number) =>
    rank === 1
      ? "bg-accent text-background"
      : rank === 2
        ? "bg-foreground/80 text-background"
        : rank === 3
          ? "bg-[#b87333] text-background"
          : "bg-line text-muted";

  return (
    <main>
      {/* 디비전 칩 + 요약 */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={`/crews/${slug}/leaderboard`} active={!div}>
          {t("crew.all")}
        </Chip>
        {DIVISIONS.map((d) => (
          <Chip
            key={d}
            href={`/crews/${slug}/leaderboard?division=${d}`}
            active={div === d}
          >
            {d.replace("_", " ").toUpperCase()}
          </Chip>
        ))}
        <span className="ml-auto shrink-0 text-[13px] text-muted">
          {t("crew.lbSummary", { n: rows.length })}
        </span>
      </div>

      {!rows.length ? (
        <Card className="mt-6 px-4 py-12 text-center">
          <p className="text-sm leading-relaxed text-muted">
            {t("crew.emptyLeaderboard")}
          </p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden">
          {/* 헤더 */}
          <div className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-5 py-2.5 text-xs text-muted">
            <span className="text-center">{t("crew.lbRank")}</span>
            <span>{t("crew.lbAthlete")}</span>
            <span className="text-right">{t("crew.lbTime")}</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li
                key={`${r.user_id}-${r.division ?? "na"}`}
                className={`grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-card-hover ${
                  r.rank === 1 ? "bg-highlight" : ""
                }`}
              >
                <span className="flex justify-center">
                  <span
                    className={`tabular flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-extrabold ${rankStyle(r.rank)}`}
                  >
                    {r.rank}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.display_name} />
                  <span className="min-w-0">
                    <Link
                      href={`/u/${r.user_id}`}
                      className="flex items-center gap-2 truncate text-base font-bold hover:text-accent"
                    >
                      {r.display_name}
                      {r.division && (
                        <Badge tone="label">
                          {r.division.replace("_", " ").toUpperCase()}
                        </Badge>
                      )}
                    </Link>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {r.session_count} {t("crew.sessionCount")}
                      {r.last_at && ` · ${formatDateShort(r.last_at, tag, tz)}`}
                    </span>
                  </span>
                </span>
                <span className="text-right">
                  <span
                    className={`tabular block text-[22px] font-extrabold ${r.rank === 1 ? "text-accent" : ""}`}
                  >
                    {formatMs(r.best_ms)}
                  </span>
                  <span className="tabular mt-0.5 block text-xs text-muted">
                    {r.rank === 1 ? t("crew.lbBest") : gap(r.best_ms)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
