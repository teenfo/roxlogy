import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShortYear } from "@/lib/format";
import {
  PFT_STATIONS,
  badgeClass,
  badgeDictKey,
  toNextBadge,
  type PftResult,
} from "@/lib/pft";
import { PftDeleteButton } from "@/components/pft-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.title") };
}

export default async function PftPage() {
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // "내 기록" 이므로 user_id 필터 필수 — shared 행은 RLS 로 전체 공개다
  const { data, error } = await supabase
    .from("pft_results")
    .select(
      "id, tested_on, total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms, age, gender, scaled, badge, location, note, shared",
    )
    .eq("user_id", user!.id)
    .is("deleted_at", null)
    .order("tested_on", { ascending: false })
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as PftResult[];
  const best = rows.reduce<PftResult | null>(
    (a, r) => (a == null || r.total_ms < a.total_ms ? r : a),
    null,
  );
  const next = best ? toNextBadge(best.total_ms, best.age, best.scaled) : null;

  return (
    <main>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("pft.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("pft.desc")}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/pft/leaderboard"
            className="rounded-md bg-surface px-4 py-2 text-sm font-semibold hover:text-accent"
          >
            {t("pft.boardTab")}
          </Link>
          <Link
            href="/pft/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
          >
            {t("pft.add")}
          </Link>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error.message}</p>}

      {/* 최고 기록 요약 */}
      {best && (
        <section className="mt-6 rounded-md bg-surface px-5 py-4">
          <p className="text-xs text-muted">{t("pft.bestTitle")}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-3xl font-black">
              {formatMs(best.total_ms)}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeClass(best.badge)}`}
            >
              {t(badgeDictKey(best.badge))}
            </span>
            {best.scaled && (
              <span className="text-[11px] text-muted">{t("pft.scaledTag")}</span>
            )}
            <span className="text-xs text-muted">
              {formatDateShortYear(best.tested_on, tag, tz)}
            </span>
          </div>
          {next && (
            <p className="mt-2 text-xs text-muted">
              {t("pft.toNext", {
                badge: t(badgeDictKey(next.next)),
                gap: formatMs(next.gapMs),
              })}
            </p>
          )}
        </section>
      )}

      {/* 기록 목록 */}
      {!rows.length ? (
        <div className="mt-6 rounded-md bg-surface px-4 py-10 text-center">
          <p className="text-sm text-muted">{t("pft.empty")}</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted">
            {t("pft.format")}
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((r) => {
            const splits = PFT_STATIONS.map((s) => ({
              key: s.key,
              label: t(s.label),
              ms: r[s.col],
            })).filter((x) => x.ms != null);
            return (
              <li key={r.id} className="rounded-md bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold">
                    {formatMs(r.total_ms)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(r.badge)}`}
                  >
                    {t(badgeDictKey(r.badge))}
                  </span>
                  {r.scaled && (
                    <span className="text-[10px] text-muted">
                      {t("pft.scaledTag")}
                    </span>
                  )}
                  {!r.shared && (
                    <span className="text-[10px] text-muted">
                      {t("pft.privateTag")}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3 text-xs text-muted">
                    {formatDateShortYear(r.tested_on, tag, tz)}
                    <Link
                      href={`/pft/${r.id}/edit`}
                      className="hover:text-accent"
                    >
                      {t("common.edit")}
                    </Link>
                    <PftDeleteButton id={r.id} />
                  </span>
                </div>

                {r.location && (
                  <p className="mt-1 text-xs text-muted">📍 {r.location}</p>
                )}

                {splits.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {splits.map((s) => (
                      <li key={s.key} className="text-xs text-muted">
                        {s.label}{" "}
                        <span className="font-mono text-foreground">
                          {formatMs(s.ms)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {r.note && (
                  <p className="mt-2 whitespace-pre-line text-xs text-muted">
                    {r.note}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 규격 안내 */}
      <section className="mt-8 rounded-md border border-muted/20 px-4 py-3">
        <h2 className="text-sm font-semibold">{t("pft.rulesTitle")}</h2>
        <ol className="mt-2 flex flex-col gap-1 text-xs text-muted">
          {PFT_STATIONS.map((s, i) => (
            <li key={s.key}>
              {i + 1}. {t(s.label)} — {t(s.spec)}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">{t("pft.rulesBadge")}</p>
      </section>
    </main>
  );
}
