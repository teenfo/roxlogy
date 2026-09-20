import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { DIVISIONS } from "@/lib/divisions";
import { QueryChoice, QuerySegments } from "@/components/rox/query-filters";
import { Person } from "@/components/rox/person";
import { Chip, DataTable, Empty, Hint, PageHead, Panel } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.leaderboard") };
}

type Row = {
  rank: number;
  display_name: string;
  division: string | null;
  best_ms: number;
};

/**
 * 커뮤니티 리더보드 — 시안 crew.tsx Leaderboard() 그대로 (PORT_PLAN §3-d):
 * PageHead("함께 뛰는 기록") · Panel "총 완주 시간"(action Choice 디비전)[ DataTable[순위 · 선수 · 디비전 · 최고 기록] · Empty · Hint ].
 * 종합/스테이션 8 보드는 우리 것이라 Panel 위 Segments(?station=)로, 리더보드 참여 안내는 rx-notice 로(§4).
 */
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ division?: string; station?: string }> }) {
  const { division, station } = await searchParams;
  const supabase = await createClient();
  const { t } = await getT();
  const user = await getCachedUser();

  const div = division && (DIVISIONS as readonly string[]).includes(division) ? division : null;
  const stationDef = STATIONS.find((s) => s.key === station) ?? null;

  const [{ data: rows }, { data: me }] = await Promise.all([
    stationDef ? supabase.rpc("leaderboard_station", { p_exercise: stationDef.exerciseId, p_division: div }) : supabase.rpc("leaderboard_overall", { p_division: div }),
    supabase.from("profiles").select("leaderboard_opt_in").eq("id", user!.id).single(),
  ]);
  const board = (rows ?? []) as Row[];
  const divLabel = (d: string) => t(`division.${d}` as Parameters<typeof t>[0]);

  return (
    <>
      <PageHead title={t("leaderboard.hero")} description={t("leaderboard.desc")} />
      {!me?.leaderboard_opt_in && (
        <div className="rx-notice">
          <div>
            <b>{t("leaderboard.optInPrompt")}</b>
            <p>
              <Link href="/settings/profile">{t("leaderboard.optInLink")}</Link>
            </p>
          </div>
        </div>
      )}
      {/* 보드 선택: 종합 + 스테이션 8 — 서버 필터라 주소(?station=)로 */}
      <QuerySegments
        label={t("leaderboard.board")}
        param="station"
        value={stationDef?.key ?? "all"}
        options={[["all", t("leaderboard.overall")], ...STATIONS.map((s) => [s.key, t(`station.${s.key}` as Parameters<typeof t>[0])] as [string, string])]}
      />
      <Panel
        title={stationDef ? t(`station.${stationDef.key}` as Parameters<typeof t>[0]) : t("crew.lbTotal")}
        action={<QueryChoice label={t("leaderboard.division")} param="division" value={div ?? "all"} options={[["all", t("leaderboard.allDivisions")], ...DIVISIONS.map((d) => [d, divLabel(d)] as [string, string])]} />}
      >
        {board.length ? (
          <DataTable
            headers={[t("crew.lbRank"), t("leaderboard.athlete"), t("leaderboard.division"), t("leaderboard.best")]}
            rows={board.map((r) => [
              <span key="rank" className={`rx-rank rank-${r.rank - 1}`}>
                {r.rank}
              </span>,
              <Person key="p" name={r.display_name} />,
              <Chip key="d">{r.division ? divLabel(r.division) : "—"}</Chip>,
              <strong key="t" className="rx-number">
                {formatMs(r.best_ms)}
              </strong>,
            ])}
          />
        ) : (
          <Empty title={t("leaderboard.empty")} description={t("leaderboard.desc")} />
        )}
        <Hint>
          {t("crew.lbSummary", { n: board.length })} · {t("leaderboard.privacyNote")}
        </Hint>
      </Panel>
    </>
  );
}
