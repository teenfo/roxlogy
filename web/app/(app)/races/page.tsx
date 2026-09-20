import Link from "next/link";
import { ArrowRight, Check, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getRaceBenchmarks } from "@/lib/cache";
import { getT } from "@/lib/i18n";
import { formatDateOnly, formatMs } from "@/lib/format";
import { percentileOf, type Benchmark } from "@/lib/percentile";
import { ExportButton } from "@/components/export-button";
import { RowLink } from "@/components/row-link";
import {
  Chip,
  DataTable,
  Empty,
  Go,
  Hint,
  PageHead,
  Panel,
  Stats,
} from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.races") };
}

/**
 * 레이스 결과 — 시안 records.tsx 의 Records(races) 그대로 (PORT_PLAN §3-b).
 * 공식 기록 연동 안내(시안에 없음)는 목록 Panel 의 Hint 로 둔다.
 */
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
  const list = races ?? [];
  const divLabel = (d: string | null) =>
    d ? t(`division.${d}` as Parameters<typeof t>[0]) : "—";

  const best = list.reduce<(typeof list)[number] | null>(
    (a, r) =>
      r.total_time_ms != null && (a == null || r.total_time_ms < a.total_time_ms!) ? r : a,
    null,
  );
  const latest = list[0] ?? null;
  const latestPct = latest
    ? percentileOf(latest.total_time_ms, latest.division, gender, bms)
    : null;

  return (
    <>
      <PageHead
        title={t("races.title")}
        description={t("races.intro")}
        action={
          <div className="rx-actions">
            {list.length > 0 && <ExportButton kind="races" />}
            <Go href="/races/new" primary>
              <Plus size={16} />
              {t("races.import")}
            </Go>
          </div>
        }
      />
      <Stats
        items={[
          [t("races.official"), String(list.length), linkedName ?? t("races.syncTitle")],
          [
            t("sessions.latest"),
            latest ? formatMs(latest.total_time_ms) : "—",
            latest ? [latest.event, divLabel(latest.division)].join(" · ") : t("dash.noRace"),
          ],
          [
            t("sessions.pb"),
            best ? formatMs(best.total_time_ms) : "—",
            best ? [best.event, divLabel(best.division)].join(" · ") : "",
          ],
          [
            t("percentile.title"),
            latestPct != null ? t("percentile.top", { pct: String(Math.round(latestPct)) }) : "—",
            latest ? latest.event : "",
          ],
        ]}
      />
      <Panel
        title={t("sessions.list")}
        action={
          <Go href="/sessions/compare">
            {t("compare.title")} <ArrowRight size={16} />
          </Go>
        }
      >
        {list.length > 0 && (
          <DataTable
            headers={[
              t("sessions.colDate"),
              t("sessions.colDivision"),
              t("percentile.title"),
              t("sessions.colTime"),
              "",
            ]}
            rows={list.map((r) => {
              const pct = percentileOf(r.total_time_ms, r.division, gender, bms);
              return [
                <RowLink className="rx-table-name" href={`/races/${r.id}`} key="name">
                  {r.event}
                  <small>
                    {r.event_date ? formatDateOnly(r.event_date, tag) : t("races.noDate")}
                  </small>
                </RowLink>,
                <Chip key="div">{divLabel(r.division)}</Chip>,
                <span className="rx-source" key="pct">
                  {pct != null ? (
                    <>
                      <Check size={14} /> {t("percentile.top", { pct: String(Math.round(pct)) })}
                    </>
                  ) : (
                    "—"
                  )}
                </span>,
                <strong className="rx-number" key="time">
                  {formatMs(r.total_time_ms)}
                </strong>,
                <RowLink
                  aria-label={t("sessions.detailOf", { name: r.event })}
                  href={`/races/${r.id}`}
                  key="go"
                >
                  <ArrowRight size={17} />
                </RowLink>,
              ];
            })}
          />
        )}
        {!list.length && (
          <Empty
            title={t("races.empty")}
            description={t("races.syncDesc")}
            action={
              <Go href="/races/new" primary>
                {t("races.import")}
              </Go>
            }
          />
        )}
        {/* 공식 기록 연동 — 시안에 없는 안내(§4-1) */}
        <Hint>
          {linkedName ? (
            <>
              {t("races.syncedTitle", { name: linkedName })} {t("races.syncedDesc")}{" "}
              <Link href="/settings/profile">{t("races.syncedCta")}</Link>
            </>
          ) : (
            <>
              {t("races.syncDesc")} <Link href="/settings/profile">{t("races.syncCta")}</Link>
              {" · "}
              {t("races.findManual")}{" "}
              <a href="https://results.hyrox.com" target="_blank" rel="noopener noreferrer">
                {t("races.findLink")}
              </a>
            </>
          )}
        </Hint>
      </Panel>
    </>
  );
}
