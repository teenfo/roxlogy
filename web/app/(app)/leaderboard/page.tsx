import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.leaderboard") };
}

const DIVISIONS = ["open", "pro", "doubles", "pro_doubles", "relay"] as const;

type Row = {
  rank: number;
  display_name: string;
  division: string | null;
  best_ms: number;
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; station?: string }>;
}) {
  const { division, station } = await searchParams;
  const supabase = await createClient();
  const { t } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const div =
    division && (DIVISIONS as readonly string[]).includes(division)
      ? division
      : null;
  const stationDef = STATIONS.find((s) => s.key === station) ?? null;

  const { data: rows } = stationDef
    ? await supabase.rpc("leaderboard_station", {
        p_exercise: stationDef.exerciseId,
        p_division: div,
      })
    : await supabase.rpc("leaderboard_overall", { p_division: div });

  const { data: me } = await supabase
    .from("profiles")
    .select("leaderboard_opt_in")
    .eq("id", user!.id)
    .single();

  const board = (rows ?? []) as Row[];
  const linkFor = (params: { division?: string; station?: string }) => {
    const qp = new URLSearchParams();
    const d = params.division ?? div ?? "";
    const st = params.station ?? station ?? "";
    if (d) qp.set("division", d);
    if (st) qp.set("station", st);
    const s = qp.toString();
    return `/leaderboard${s ? `?${s}` : ""}`;
  };

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("leaderboard.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("leaderboard.desc")}</p>

      {!me?.leaderboard_opt_in && (
        <p className="mt-4 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm text-muted">
          {t("leaderboard.optInPrompt")}{" "}
          <Link
            href="/settings/profile"
            className="text-accent hover:underline"
          >
            {t("leaderboard.optInLink")}
          </Link>
        </p>
      )}

      {/* 보드 선택: 종합 + 스테이션 8 */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={linkFor({ station: "" })}
          className={`rounded-full border px-3 py-1 text-xs ${!stationDef ? "border-accent text-accent" : "border-muted/40 text-muted hover:border-foreground"}`}
        >
          {t("leaderboard.overall")}
        </Link>
        {STATIONS.map((s) => (
          <Link
            key={s.key}
            href={linkFor({ station: s.key })}
            className={`rounded-full border px-3 py-1 text-xs ${stationDef?.key === s.key ? "border-accent text-accent" : "border-muted/40 text-muted hover:border-foreground"}`}
          >
            {t(`station.${s.key}` as Parameters<typeof t>[0])}
          </Link>
        ))}
      </div>

      {/* 디비전 필터 */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={linkFor({ division: "" })}
          className={`text-xs ${!div ? "font-semibold text-foreground" : "text-muted hover:text-foreground"}`}
        >
          {t("leaderboard.allDivisions")}
        </Link>
        {DIVISIONS.map((d) => (
          <Link
            key={d}
            href={linkFor({ division: d })}
            className={`text-xs ${div === d ? "font-semibold text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {t(`division.${d}`)}
          </Link>
        ))}
      </div>

      {!board.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("leaderboard.empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-md bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-background text-left text-xs text-muted">
                <th className="px-4 py-2 font-normal">#</th>
                <th className="px-4 py-2 font-normal">{t("leaderboard.athlete")}</th>
                <th className="px-4 py-2 font-normal">{t("leaderboard.division")}</th>
                <th className="px-4 py-2 text-right font-normal">
                  {t("leaderboard.best")}
                </th>
              </tr>
            </thead>
            <tbody>
              {board.map((r) => (
                <tr
                  key={`${r.rank}-${r.display_name}`}
                  className="border-b border-background/60"
                >
                  <td className="px-4 py-2.5 font-mono text-muted">{r.rank}</td>
                  <td className="px-4 py-2.5">{r.display_name}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {r.division
                      ? t(`division.${r.division}` as Parameters<typeof t>[0])
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">
                    {formatMs(r.best_ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">{t("leaderboard.privacyNote")}</p>
    </main>
  );
}
