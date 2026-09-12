"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { formatMs, formatDateShortYear } from "@/lib/format";
import { PFT_STATIONS, badgeClass, badgeDictKey, pftBadge } from "@/lib/pft";
import { Card } from "@/components/ui/crew-ui";

/** 목록 한 줄이 알아야 하는 것 — 레이스와 "내가 무엇이었나" */
export type RaceListRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  created_at: string;
  join_open: boolean;
  crew: string | null;
  /** 내가 참가자인가 */
  mine: boolean;
  /** 내가 만든(운영하는) 레이스인가 */
  created: boolean;
  started: boolean;
  doneCount: number;
  finished: boolean;
  total_ms: number | null;
  scaled: boolean;
};

// 목록은 한 줄에 링크 세 개가 들어가야 해서 본문 버튼보다 작게 쓴다
const BTN =
  "flex h-8 items-center rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-muted/60";

/** 레이스 전체 목록의 표시 부분 — 데이터는 페이지가 읽어 넘긴다. */
export function PftRaceList({
  rows,
  age,
  locale,
  tz,
}: {
  rows: RaceListRow[];
  age: number | null;
  locale: string;
  tz?: string;
}) {
  const { t } = useI18n();
  const open = rows.filter((r) => r.status !== "closed");
  const past = rows.filter((r) => r.status === "closed");

  const section = (title: string, list: RaceListRow[]) =>
    list.length === 0 ? null : (
      <section className="flex flex-col gap-2">
        <p className="text-sm font-bold">
          {title} <span className="tabular text-muted">{list.length}</span>
        </p>
        <ul className="flex flex-col gap-2">
          {list.map((r) => {
            const badge = r.finished && r.total_ms != null ? pftBadge(r.total_ms, age, r.scaled) : null;
            return (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-extrabold">{r.title}</span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          r.status === "closed" ? "bg-line text-muted" : "bg-success-bg text-success"
                        }`}
                      >
                        {t(r.status === "closed" ? "pft.race.ended" : "pft.race.open")}
                      </span>
                      {r.created && (
                        <span className="rounded-md bg-highlight px-2 py-0.5 text-[11px] font-bold text-accent">
                          {t("pft.race.roleStaff")}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {formatDateShortYear(r.created_at, locale, tz)}
                      {r.crew && ` · ${r.crew}`}
                      {r.join_open && ` · ${r.code}`}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    {r.finished ? (
                      <>
                        <span className="tabular block text-lg font-extrabold">{formatMs(r.total_ms)}</span>
                        {badge && (
                          <span
                            className={`mt-0.5 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${badgeClass(badge)}`}
                          >
                            {t(badgeDictKey(badge))}
                          </span>
                        )}
                      </>
                    ) : r.mine ? (
                      <span className="text-xs text-muted">
                        {r.started
                          ? t("pft.race.progressN", { n: r.doneCount, total: PFT_STATIONS.length })
                          : t("pft.race.waiting")}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </span>

                  <span className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <Link href={`/board/${r.code}`} className={BTN}>
                      {t("pft.race.linkBoard")}
                    </Link>
                    <Link href={`/pft/race/${r.code}`} className={BTN}>
                      {r.mine ? t("pft.race.linkMine") : t("pft.race.linkOpen")}
                    </Link>
                    {r.created && (
                      <Link href={`/pft/race/${r.code}/staff`} className={BTN}>
                        {t("pft.race.linkStaff")}
                      </Link>
                    )}
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    );

  return (
    <>
      {section(t("pft.race.sectionOpen"), open)}
      {section(t("pft.race.sectionPast"), past)}
    </>
  );
}
