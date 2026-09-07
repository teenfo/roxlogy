import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShortYear } from "@/lib/format";
import { badgeClass, badgeDictKey } from "@/lib/pft";

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
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-xs ${
      on ? "bg-accent font-bold text-background" : "bg-surface text-muted hover:text-foreground"
    }`;

  return (
    <main>
      <Link href="/pft" className="text-sm text-muted hover:text-foreground">
        ← {t("pft.title")}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{t("pft.boardTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("pft.boardDesc")}</p>

      {!me?.leaderboard_opt_in && (
        <p className="mt-4 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm text-muted">
          {t("leaderboard.optInPrompt")}{" "}
          <Link href="/settings/profile" className="text-accent hover:underline">
            {t("leaderboard.optInLink")}
          </Link>
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-1.5">
        <Link href={linkFor({ gender: null })} className={chip(!g)}>
          {t("pft.allGenders")}
        </Link>
        {GENDERS.map((x) => (
          <Link key={x} href={linkFor({ gender: x })} className={chip(g === x)}>
            {t(x === "male" ? "pft.male" : "pft.female")}
          </Link>
        ))}
        <span className="mx-1 w-px bg-muted/20" />
        <Link href={linkFor({ age: null })} className={chip(!ag)}>
          {t("pft.allAges")}
        </Link>
        {AGE_GROUPS.map((x) => (
          <Link key={x} href={linkFor({ age: x })} className={chip(ag === x)}>
            {t(x === "u45" ? "pft.u45" : "pft.o45")}
          </Link>
        ))}
      </div>

      {!board.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("pft.boardEmpty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-px overflow-hidden rounded-md bg-muted/20">
          {board.map((r) => (
            <li
              key={r.user_id}
              className={`flex items-center gap-3 px-4 py-3 ${
                r.user_id === user!.id ? "bg-accent/10" : "bg-surface"
              }`}
            >
              <span className="w-8 shrink-0 text-right font-mono text-sm text-muted">
                {r.rank}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  href={`/u/${r.user_id}`}
                  className="block truncate text-sm font-semibold hover:text-accent"
                >
                  {r.display_name}
                </Link>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  {formatDateShortYear(r.tested_on, tag, tz)}
                  {r.age != null && <span>{t("pft.ageYears", { n: r.age })}</span>}
                  {r.scaled && <span>{t("pft.scaledTag")}</span>}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(r.badge)}`}
              >
                {t(badgeDictKey(r.badge))}
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-sm font-bold">
                {formatMs(r.total_ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
