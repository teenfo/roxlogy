import { notFound } from "next/navigation";
import { getCrew, getCrewLeaderboard } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { CrewLoginGate } from "@/components/crew-login-gate";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShort } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
// 디비전 목록은 단일 출처를 쓴다 — 여기 하드코딩된 목록에 믹스 더블·믹스
// 릴레이가 빠져 있어 크루 리더보드에만 그 탭이 없었다.
import { DIVISIONS } from "@/lib/divisions";
import { QueryChoice } from "@/components/rox/query-filters";
import { Person } from "@/components/rox/person";
import { Chip, DataTable, Empty, Hint, PageHead, Panel } from "@/components/rox/ui";

/**
 * 크루 리더보드 — 시안 crew.tsx Leaderboard({crew}) 그대로 (PORT_PLAN §3-e):
 * PageHead · Panel "총 완주 시간"(action Choice 디비전)[ DataTable[순위 · 선수 · 디비전 · 최고 기록] · Empty · Hint ].
 * 디비전은 서버 필터(?division=)라 QueryChoice 로. 1위 격차·세션 수는 우리 것이라 선수 행의 작은 줄에(§4).
 */
export default async function CrewLeaderboardPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ division?: string }> }) {
  const { slug } = await params;
  const { division } = await searchParams;
  const div = (DIVISIONS as readonly string[]).includes(division ?? "") ? division! : null;

  const [crew, user, { t, tag, tz }] = await Promise.all([getCrew(slug), getCachedUser(), getT()]);
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
  const divLabel = (d: string) => dictLabel(t, `division.${d}`, d.replace("_", " ").toUpperCase());

  return (
    <>
      <PageHead title={t("crew.lbTitle")} description={t("crew.lbDesc")} />
      <Panel
        title={t("crew.lbTotal")}
        action={<QueryChoice label={t("crew.lbDivision")} param="division" value={div ?? "all"} options={[["all", t("crew.all")], ...DIVISIONS.map((d) => [d, divLabel(d)] as [string, string])]} />}
      >
        {rows.length ? (
          <DataTable
            headers={[t("crew.lbRank"), t("crew.lbAthlete"), t("crew.lbDivision"), t("crew.lbBestCol")]}
            rows={rows.map((r) => [
              <span key="rank" className={`rx-rank rank-${r.rank - 1}`}>
                {r.rank}
              </span>,
              <Person key="p" name={r.display_name} note={`${r.session_count} ${t("crew.sessionCount")}${r.last_at ? ` · ${formatDateShort(r.last_at, tag, tz)}` : ""}`} />,
              <Chip key="d">{r.division ? divLabel(r.division) : "—"}</Chip>,
              <strong key="t" className="rx-number">
                {formatMs(r.best_ms)}
                {r.rank !== 1 && gap(r.best_ms) && <small className="rx-muted"> {gap(r.best_ms)}</small>}
              </strong>,
            ])}
          />
        ) : (
          <Empty title={t("crew.emptyLeaderboard")} description={t("crew.lbDesc")} />
        )}
        <Hint>{t("crew.lbSummary", { n: rows.length })}</Hint>
      </Panel>
    </>
  );
}
