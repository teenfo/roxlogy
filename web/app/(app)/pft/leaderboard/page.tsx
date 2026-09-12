import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShortYear } from "@/lib/format";
import { badgeClass, badgeDictKey } from "@/lib/pft";
import { Avatar, Card, Chip } from "@/components/ui/crew-ui";

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
    supabase.rpc("pft_leaderboard", {
      p_gender: g,
      p_age_group: ag,
      p_limit: 100,
    }),
    supabase
      .from("profiles")
      .select("leaderboard_opt_in")
      .eq("id", user!.id)
      .maybeSingle(),
  ]);
  const board = (rows ?? []) as BoardRow[];

  const linkFor = (p: { gender?: string | null; age?: string | null }) => {
    const qp = new URLSearchParams();
    const gg = p.gender === undefined ? g : p.gender;
    const aa = p.age === undefined ? ag : p.age;
    if (gg) qp.set("gender", gg);
    if (aa) qp.set("age", aa);
    const s = qp.toString();
    return `/pft/leaderboard${s ? `?${s}` : ""}`;
  };
  const topMs = board[0]?.total_ms ?? null;
  const gapLabel = (ms: number) => {
    if (topMs == null || ms <= topMs) return null;
    const d = Math.round((ms - topMs) / 1000);
    return `+${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
  };
  const rankStyle = (rank: number) =>
    rank === 1
      ? "bg-accent text-background"
      : rank === 2
        ? "bg-[#c9c9c9] text-background"
        : rank === 3
          ? "bg-[#b87333] text-background"
          : "bg-line text-muted";

  return (
    <main className="flex flex-col gap-[22px]">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/pft"
            className="text-[13px] text-muted hover:text-foreground"
          >
            ← {t("pft.title")}
          </Link>
          <h1 className="mt-2 text-[26px] font-extrabold">
            {t("pft.boardTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("pft.boardDesc")}</p>
        </div>
        <Link
          href="/pft/measure"
          className="flex h-10 shrink-0 items-center rounded-lg bg-accent px-4 text-sm font-extrabold text-background hover:brightness-110"
        >
          ▶ {t("pft.mStartCta")}
        </Link>
      </div>

      {!me?.leaderboard_opt_in && (
        <Card className="px-5 py-3.5">
          <p className="text-sm text-muted">
            {t("leaderboard.optInPrompt")}{" "}
            <Link href="/settings/profile" className="text-accent hover:underline">
              {t("leaderboard.optInLink")}
            </Link>
          </p>
        </Card>
      )}

      {/* 필터 바 */}
      <Card className="flex flex-wrap items-center gap-2 px-3.5 py-3">
        <span className="text-xs text-muted">{t("pft.fltGender")}</span>
        <Chip href={linkFor({ gender: null })} active={!g}>
          {t("pft.allGenders")}
        </Chip>
        {GENDERS.map((x) => (
          <Chip key={x} href={linkFor({ gender: x })} active={g === x}>
            {t(x === "male" ? "pft.male" : "pft.female")}
          </Chip>
        ))}
        <span aria-hidden className="mx-2 h-5 w-px bg-line-mid" />
        <span className="text-xs text-muted">{t("pft.fltAge")}</span>
        <Chip href={linkFor({ age: null })} active={!ag}>
          {t("pft.allAges")}
        </Chip>
        {AGE_GROUPS.map((x) => (
          <Chip key={x} href={linkFor({ age: x })} active={ag === x}>
            {t(x === "u45" ? "pft.u45" : "pft.o45")}
          </Chip>
        ))}
        <span className="ml-auto text-[13px] text-muted">
          {t("pft.boardCount", { n: board.length })}
        </span>
      </Card>

      {!board.length ? (
        <div className="rounded-2xl border border-dashed border-line-strong px-5 py-12 text-center">
          <p className="text-base font-bold">{t("pft.boardEmpty")}</p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-5 py-2.5 text-xs text-muted sm:grid-cols-[48px_minmax(0,1fr)_80px_auto]">
            <span className="text-center">{t("crew.lbRank")}</span>
            <span>{t("pft.boardAthlete")}</span>
            <span className="hidden sm:block">{t("pft.badgeCol")}</span>
            <span className="text-right">{t("crew.lbTime")}</span>
          </div>
          <ul className="divide-y divide-line">
            {board.map((r) => {
              const isMe = r.user_id === user!.id;
              return (
                <li
                  key={r.user_id}
                  className={`grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors sm:grid-cols-[48px_minmax(0,1fr)_80px_auto] ${
                    isMe
                      ? "bg-highlight"
                      : r.rank === 1
                        ? "bg-[#161512]"
                        : "hover:bg-card-hover"
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
                        className="flex items-center gap-1.5 truncate text-base font-bold hover:text-accent"
                      >
                        {r.display_name}
                        {isMe && (
                          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold text-background">
                            ME
                          </span>
                        )}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                        {formatDateShortYear(r.tested_on, tag, tz)}
                        {r.age != null && (
                          <span>{t("pft.ageYears", { n: r.age })}</span>
                        )}
                        {r.gender && (
                          <span>
                            {t(r.gender === "male" ? "pft.male" : "pft.female")}
                          </span>
                        )}
                        {r.scaled && <span>{t("pft.scaledTag")}</span>}
                      </span>
                    </span>
                  </span>

                  <span className="hidden sm:block">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${badgeClass(r.badge)}`}
                    >
                      {t(badgeDictKey(r.badge))}
                    </span>
                  </span>

                  <span className="text-right">
                    <span
                      className={`tabular block text-[22px] font-extrabold ${r.rank === 1 ? "text-accent" : ""}`}
                    >
                      {formatMs(r.total_ms)}
                    </span>
                    <span className="tabular mt-0.5 block text-xs text-muted">
                      {r.rank === 1 ? t("pft.boardTop") : gapLabel(r.total_ms)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </main>
  );
}
