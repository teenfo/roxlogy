import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShortYear } from "@/lib/format";
import {
  PFT_COLORS,
  PFT_STATIONS,
  badgeClass,
  badgeDictKey,
  cutoffsFor,
  toNextBadge,
  type PftResult,
} from "@/lib/pft";
import { Card } from "@/components/ui/crew-ui";
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

  // 레이스 보드 — 내가 참가한 최근 레이스 + 만들 수 있는지(관리자·크루 운영진)
  const [{ data: myRaces }, { data: createdRaces }, { data: staffRows }, { data: profile }] = await Promise.all([
    supabase
      .from("pft_race_entries")
      .select("joined_at, finished_at, total_ms, pft_races ( code, title, status, created_at )")
      .eq("user_id", user!.id)
      .order("joined_at", { ascending: false })
      .limit(5),
    // 내가 만든 레이스 — 참가하지 않아도 스태프 타이밍으로 들어갈 수 있게
    supabase
      .from("pft_races")
      .select("code, title, status, created_at")
      .eq("created_by", user!.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("crew_members")
      .select("id")
      .eq("user_id", user!.id)
      .eq("status", "active")
      .in("role", ["owner", "coach"])
      .limit(1),
    supabase.from("profiles").select("is_admin").eq("id", user!.id).maybeSingle(),
  ]);
  type RaceRow = {
    joined_at: string;
    finished_at: string | null;
    total_ms: number | null;
    pft_races: { code: string; title: string; status: string; created_at: string } | { code: string; title: string; status: string; created_at: string }[] | null;
  };
  const races = ((myRaces ?? []) as unknown as RaceRow[])
    .map((r) => ({ ...r, race: Array.isArray(r.pft_races) ? r.pft_races[0] : r.pft_races }))
    .filter((r) => r.race);
  const canCreateRace = !!profile?.is_admin || (staffRows ?? []).length > 0;
  const created = ((createdRaces ?? []) as { code: string; title: string; status: string; created_at: string }[]).filter(
    (r) => !races.some((x) => x.race!.code === r.code),
  );
  const best = rows.reduce<PftResult | null>(
    (a, r) => (a == null || r.total_ms < a.total_ms ? r : a),
    null,
  );
  const next = best ? toNextBadge(best.total_ms, best.age, best.scaled) : null;

  const cuts = cutoffsFor(best?.age ?? null);
  // 배지 게이지 — 0~30분 스케일 위에 골드·실버 구간과 내 위치를 얹는다.
  // 숫자만으로는 "골드까지 얼마나 남았나"가 감이 안 온다.
  const SCALE = 30 * 60_000;
  const pctOf = (ms: number) => Math.min(100, (ms / SCALE) * 100);

  return (
    <main className="flex flex-col gap-[22px]">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t("pft.title")}
          </h1>
          <p className="mt-1 text-[15px] text-muted">{t("pft.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/pft/leaderboard"
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-muted/60"
          >
            {t("pft.boardTab")}
          </Link>
          <Link
            href="/pft/new"
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-muted/60"
          >
            {t("pft.add")}
          </Link>
          <Link
            href="/pft/race/join"
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-muted/60"
          >
            {t("pft.race.join")}
          </Link>
          {canCreateRace && (
            <Link
              href="/pft/race/new"
              className="flex h-10 items-center rounded-lg border border-line-accent bg-highlight px-4 text-sm font-semibold text-accent hover:brightness-110"
            >
              {t("pft.race.create")}
            </Link>
          )}
          <Link
            href="/pft/measure"
            className="flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-extrabold text-background hover:brightness-110"
          >
            ▶ {t("pft.mStartCta")}
          </Link>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error.message}</p>}

      {best ? (
        <section className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
          {/* MY BEST */}
          <Card highlight className="flex flex-col gap-3.5 px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-extrabold tracking-[0.1em] text-accent">
                MY BEST
              </span>
              <span className="text-xs text-[#8a7a2a]">
                {formatDateShortYear(best.tested_on, tag, tz)}
                {best.age != null && ` · ${t("pft.ageN", { n: best.age })}`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="tabular text-[52px] font-extrabold leading-none tracking-tight text-accent">
                {formatMs(best.total_ms)}
              </span>
              <span
                className={`rounded-md px-2.5 py-1 text-xs font-extrabold ${badgeClass(best.badge)}`}
              >
                {t(badgeDictKey(best.badge))}
              </span>
              {best.scaled && (
                <span className="text-xs text-muted">{t("pft.scaledTag")}</span>
              )}
            </div>

            {/* 배지 게이지 */}
            <div>
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="text-foreground/80">
                  {next ? (
                    <>
                      {t(badgeDictKey(next.next))}{" "}
                      <b className="font-bold text-accent">
                        {formatMs(next.gapMs)}
                      </b>{" "}
                      {t("pft.toCut")}
                    </>
                  ) : (
                    <span className="text-accent">{t("pft.topBadge")}</span>
                  )}
                </span>
                <span className="tabular ml-auto text-muted">
                  {t("pft.badge.gold")} &lt;{formatMs(cuts.gold)} ·{" "}
                  {t("pft.badge.silver")} &lt;{formatMs(cuts.silver)}
                </span>
              </div>
              <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-[#2a2500]">
                <span
                  className="absolute inset-y-0 left-0 bg-accent"
                  style={{ width: `${pctOf(cuts.gold)}%` }}
                />
                <span
                  className="absolute inset-y-0 bg-muted-3"
                  style={{
                    left: `${pctOf(cuts.gold)}%`,
                    width: `${pctOf(cuts.silver) - pctOf(cuts.gold)}%`,
                  }}
                />
                <span
                  className="absolute inset-y-0 w-0.5 bg-foreground"
                  style={{ left: `${pctOf(best.total_ms)}%` }}
                />
              </div>
            </div>

            {/* 종목별 스플릿 */}
            {PFT_STATIONS.some((st) => best[st.col] != null) && (
              <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {PFT_STATIONS.map((st) => (
                  <li
                    key={st.key}
                    className="rounded-lg border border-line bg-card px-1.5 py-2 text-center"
                  >
                    <p className="truncate text-[10px] text-muted">{t(st.label)}</p>
                    <p
                      className="tabular mt-0.5 text-[13px] font-bold"
                      style={{ color: PFT_COLORS[st.key] }}
                    >
                      {best[st.col] != null ? formatMs(best[st.col]) : "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 최근 기록 */}
          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-[15px] font-extrabold">{t("pft.recent")}</h2>
              <span className="text-xs text-muted">
                {t("pft.recordN", { n: rows.length })}
              </span>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {rows.slice(0, 4).map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 py-2.5">
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${badgeClass(r.badge)}`}
                  >
                    {t(badgeDictKey(r.badge))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {formatDateShortYear(r.tested_on, tag, tz)}
                    </span>
                    {(r.location || r.scaled) && (
                      <span className="block truncate text-xs text-muted">
                        {[r.location, r.scaled ? t("pft.scaledTag") : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular block text-base font-extrabold">
                      {formatMs(r.total_ms)}
                    </span>
                    <span
                      className={`tabular block text-xs ${r.id === best.id ? "text-accent" : "text-muted"}`}
                    >
                      {r.id === best.id
                        ? t("pft.bestTitle")
                        : `+${formatMs(r.total_ms - best.total_ms)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : (
        <Card highlight className="px-6 py-10 text-center">
          <p className="text-base font-bold">{t("pft.empty")}</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-muted">
            {t("pft.format")}
          </p>
          <Link
            href="/pft/measure"
            className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-extrabold text-background hover:brightness-110"
          >
            ▶ {t("pft.mStartCta")}
          </Link>
        </Card>
      )}

      {/* 전체 기록 */}
      {rows.length > 0 && (
        <section>
          <h2 className="mb-2 text-[15px] font-extrabold">{t("pft.allRecords")}</h2>
          <Card className="divide-y divide-line overflow-hidden">
            {rows.map((r) => {
              const splits = PFT_STATIONS.map((st) => ({
                key: st.key,
                label: t(st.label),
                ms: r[st.col],
              })).filter((x) => x.ms != null);
              return (
                <div key={r.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-lg font-extrabold">
                      {formatMs(r.total_ms)}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-bold ${badgeClass(r.badge)}`}
                    >
                      {t(badgeDictKey(r.badge))}
                    </span>
                    {r.scaled && (
                      <span className="text-xs text-muted">
                        {t("pft.scaledTag")}
                      </span>
                    )}
                    {!r.shared && (
                      <span className="text-xs text-muted">
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
                      {splits.map((sp) => (
                        <li key={sp.key} className="text-xs text-muted">
                          {sp.label}{" "}
                          <span
                            className="tabular font-semibold"
                            style={{ color: PFT_COLORS[sp.key] }}
                          >
                            {formatMs(sp.ms)}
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
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {/* 종목 순서 · 규격 */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h2 className="text-[15px] font-extrabold">{t("pft.rulesTitle")}</h2>
          <span className="text-xs text-muted">{t("pft.noRest")}</span>
          <span className="tabular ml-auto text-xs text-muted">
            {t("pft.badge.gold")} &lt;{formatMs(cuts.gold)} ·{" "}
            {t("pft.badge.silver")} &lt;{formatMs(cuts.silver)}
          </span>
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {PFT_STATIONS.map((st, i) => (
            <li
              key={st.key}
              className="rounded-xl border border-line bg-inset px-3 py-3.5"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-background">
                  {i + 1}
                </span>
                <span className="truncate text-sm font-bold">{t(st.label)}</span>
              </span>
              <p className="mt-1.5 text-base font-extrabold text-foreground/90">
                {t(st.amount)}
              </p>
              {t(st.detail) && (
                <p className="mt-0.5 text-xs leading-snug text-muted">
                  {t(st.detail)}
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">{t("pft.rulesBadge")}</p>
      </section>
      {/* 레이스 보드 — 최근 참가 */}
      {races.length > 0 && (
        <Card className="p-4 sm:p-5">
          <p className="flex items-baseline justify-between gap-3 text-sm font-bold">
            {t("pft.race.mine")}
            <Link href="/pft/race" className="text-xs font-semibold text-accent hover:underline">
              {t("pft.race.viewAll")}
            </Link>
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {races.map((r) => (
              <li key={r.race!.code}>
                <Link
                  href={`/pft/race/${r.race!.code}`}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-inset px-3.5 py-2.5 hover:bg-card-hover"
                >
                  <span className="font-mono text-xs font-bold tracking-[0.2em] text-muted">{r.race!.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.race!.title}</span>
                  <span className="text-xs text-muted">
                    {r.finished_at
                      ? formatMs(r.total_ms)
                      : t(r.race!.status === "closed" ? "pft.race.closed" : "pft.race.open")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {created.length > 0 && (
        <Card className="p-4 sm:p-5">
          <p className="flex items-baseline justify-between gap-3 text-sm font-bold">
            {t("pft.race.created")}
            <Link href="/pft/race" className="text-xs font-semibold text-accent hover:underline">
              {t("pft.race.viewAll")}
            </Link>
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {created.map((r) => (
              <li key={r.code}>
                <Link
                  href={`/pft/race/${r.code}/staff`}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-inset px-3.5 py-2.5 hover:bg-card-hover"
                >
                  <span className="font-mono text-xs font-bold tracking-[0.2em] text-muted">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.title}</span>
                  <span className="text-xs text-muted">
                    {t(r.status === "closed" ? "pft.race.closed" : "pft.race.open")} · {t("pft.race.staff")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
