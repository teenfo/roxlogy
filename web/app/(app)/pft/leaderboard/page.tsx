import Link from "next/link";
import { Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShortYear } from "@/lib/format";
import { badgeDictKey } from "@/lib/pft";
import { Back, Chip, DataTable, Empty, Go, Hint, PageHead, Panel } from "@/components/rox/ui";
import { QueryChoice } from "@/components/rox/query-filters";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.boardTitle") };
}

type BoardRow = {
  rank: number;
  user_id: string;
  display_name: string;
  total_ms: number;
  badge: string;
  tested_on: string;
  gender: string | null;
  age: number | null;
  scaled: boolean;
};

const GENDERS = ["male", "female"] as const;
const AGE_GROUPS = ["u45", "o45"] as const;

/**
 * PFT 리더보드 — 시안 racing.tsx PFT(leaderboard) 그대로 (PORT_PLAN §3-d):
 * Back · PageHead(개인 측정) · Panel "완주 결과"(action: Choice 성별 · DataTable 순위/선수/성별/완주 시간/상태 · Hint).
 * 필터는 쿼리스트링(서버)이라 QueryChoice. 연령대 필터는 우리 것이라 Choice 를 하나 더 둔다.
 */
export default async function PftLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ gender?: string; age?: string }>;
}) {
  const { gender, age } = await searchParams;
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const g = (GENDERS as readonly string[]).includes(gender ?? "") ? gender! : null;
  const ag = (AGE_GROUPS as readonly string[]).includes(age ?? "") ? age! : null;

  const supabase = await createClient();
  const [{ data: rows }, { data: me }] = await Promise.all([
    supabase.rpc("pft_leaderboard", { p_gender: g, p_age_group: ag, p_limit: 100 }),
    supabase.from("profiles").select("leaderboard_opt_in").eq("id", user!.id).maybeSingle(),
  ]);
  const board = (rows ?? []) as BoardRow[];
  const topMs = board[0]?.total_ms ?? null;
  const gapLabel = (ms: number) => {
    if (topMs == null || ms <= topMs) return t("pft.boardTop");
    const d = Math.round((ms - topMs) / 1000);
    return `+${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
  };

  return (
    <>
      <Back href="/pft" label={t("pft.title")} />
      <PageHead
        title={t("pft.boardTitle")}
        description={t("pft.boardDesc")}
        action={
          <Go href="/pft/measure">
            <Timer size={17} />
            {t("pft.mStartCta")}
          </Go>
        }
      />
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
      <Panel
        title={t("pft.finishResults")}
        action={
          <div className="rx-actions">
            <QueryChoice
              param="gender"
              value={g ?? "all"}
              label={t("pft.fltGender")}
              options={[
                ["all", t("pft.allGenders")],
                ...GENDERS.map((x) => [x, t(x === "male" ? "pft.male" : "pft.female")] as [string, string]),
              ]}
            />
            <QueryChoice
              param="age"
              value={ag ?? "all"}
              label={t("pft.fltAge")}
              options={[
                ["all", t("pft.allAges")],
                ...AGE_GROUPS.map((x) => [x, t(x === "u45" ? "pft.u45" : "pft.o45")] as [string, string]),
              ]}
            />
          </div>
        }
      >
        <p className="rx-list-count">{t("pft.boardCount", { n: board.length })}</p>
        {board.length ? (
          <DataTable
            headers={[t("crew.lbRank"), t("pft.boardAthlete"), t("pft.fltGender"), t("crew.lbTime"), t("pft.statusCol")]}
            rows={board.map((r) => {
              const isMe = r.user_id === user!.id;
              return [
                <strong key="r" className="rx-number">
                  {r.rank}
                </strong>,
                <span key="a">
                  <Link href={`/u/${r.user_id}`}>
                    <b>{r.display_name}</b>
                  </Link>
                  {isMe && <Chip tone="yellow">ME</Chip>}
                  <small className="rx-block rx-muted">
                    {formatDateShortYear(r.tested_on, tag, tz)}
                    {r.age != null && ` · ${t("pft.ageYears", { n: r.age })}`}
                    {r.scaled && ` · ${t("pft.scaledTag")}`}
                  </small>
                </span>,
                <span key="g">{r.gender ? t(r.gender === "male" ? "pft.male" : "pft.female") : "—"}</span>,
                <span key="t">
                  <strong className="rx-number">{formatMs(r.total_ms)}</strong>
                  <small className="rx-block rx-muted">{gapLabel(r.total_ms)}</small>
                </span>,
                <Chip key="b" tone={r.badge === "gold" ? "yellow" : "green"}>
                  {t(badgeDictKey(r.badge))}
                </Chip>,
              ];
            })}
          />
        ) : (
          <Empty title={t("pft.boardEmpty")} description={t("pft.boardDesc")} />
        )}
        <Hint>{t("pft.rulesBadge")}</Hint>
      </Panel>
    </>
  );
}
