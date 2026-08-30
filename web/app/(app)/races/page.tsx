import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getRaceBenchmarks } from "@/lib/cache";
import { getT } from "@/lib/i18n";
import { formatDateOnly, formatMs } from "@/lib/format";
import { percentileOf, type Benchmark } from "@/lib/percentile";
import { ExportButton } from "@/components/export-button";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.races") };
}

export default async function RacesPage() {
  const supabase = await createClient();
  const { t, tag } = await getT();
  const user = await getCachedUser();
  const [{ data: races }, profile, benchmarks] = await Promise.all([
    supabase
      .from("race_results")
      .select("id, event, event_date, division, total_time_ms")
      .eq("user_id", user!.id)
      .order("event_date", { ascending: false }),
    getCachedProfile(), // 레이아웃과 공유
    getRaceBenchmarks(), // 전역 캐시
  ]);
  const bms = (benchmarks ?? []) as Benchmark[];
  const gender = profile?.gender ?? null;
  const linkedName = profile?.hyrox_athlete_name ?? null;

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("races.title")}</h1>
        <div className="flex items-center gap-3">
          {!!races?.length && <ExportButton kind="races" />}
          <Link
            href="/races/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
          >
            {t("races.register")}
          </Link>
        </div>
      </div>

      {/* 공식 기록 연동 안내 — 연동 여부에 따라 문구·행동이 달라진다.
          연동은 이미 동작하는 기능이다(설정 → 선수 연동 → 주간 자동 등록). */}
      <section className="mt-4 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm">
        {linkedName ? (
          <>
            <p className="font-semibold">
              {t("races.syncedTitle", { name: linkedName })}
            </p>
            <p className="mt-1 text-muted">{t("races.syncedDesc")}</p>
            <Link
              href="/settings/profile"
              className="mt-2 inline-block text-accent hover:underline"
            >
              {t("races.syncedCta")}
            </Link>
          </>
        ) : (
          <>
            <p className="font-semibold">{t("races.syncTitle")}</p>
            <p className="mt-1 text-muted">{t("races.syncDesc")}</p>
            <Link
              href="/settings/profile"
              className="mt-2 inline-block text-accent hover:underline"
            >
              {t("races.syncCta")}
            </Link>
            <p className="mt-2 text-xs text-muted">
              {t("races.findManual")}{" "}
              <a
                href="https://results.hyrox.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {t("races.findLink")}
              </a>
            </p>
          </>
        )}
      </section>

      {!races?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("races.empty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {races.map((r) => {
            const pct = percentileOf(r.total_time_ms, r.division, gender, bms);
            return (
              <li key={r.id}>
                <Link
                  href={`/races/${r.id}`}
                  className="flex items-center justify-between rounded-md bg-surface px-4 py-3.5 hover:bg-surface/70"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">{r.event}</span>
                    <span className="text-xs text-muted">
                      {r.event_date ? formatDateOnly(r.event_date, tag) : t("races.noDate")} ·{" "}
                      {r.division
                        ? t(`division.${r.division}` as Parameters<typeof t>[0])
                        : "—"}
                    </span>
                  </div>
                  <span className="flex items-center gap-3">
                    {pct != null && (
                      <span className="rounded-full bg-track/15 px-2 py-0.5 text-xs font-semibold text-track">
                        {t("percentile.top", { pct: String(Math.round(pct)) })}
                      </span>
                    )}
                    <span className="font-mono text-lg font-semibold text-accent">
                      {formatMs(r.total_time_ms)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
