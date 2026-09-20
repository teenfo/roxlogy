"use client";

import { useI18n } from "@/components/i18n-provider";
import { formatMs, formatDateShortYear } from "@/lib/format";
import { PFT_STATIONS, badgeDictKey, pftBadge } from "@/lib/pft";
import { Chip, Go, Panel, RecordRow } from "@/components/rox/ui";

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

/**
 * 레이스 전체 목록 — 시안 허브의 "크루 PFT 레이스" Panel(PftRaceLink 행 + 스태프·보드 버튼)
 * 을 진행 중·지난 레이스 두 Panel 로 나눈다(PORT_PLAN §3-d). 데이터는 페이지가 읽어 넘긴다.
 */
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
      <Panel title={title} action={<Chip>{list.length}</Chip>}>
        {list.map((r) => {
          const badge = r.finished && r.total_ms != null ? pftBadge(r.total_ms, age, r.scaled) : null;
          const note = [
            formatDateShortYear(r.created_at, locale, tz),
            r.crew,
            r.join_open ? r.code : null,
            t(r.status === "closed" ? "pft.race.ended" : "pft.race.open"),
            r.created ? t("pft.race.roleStaff") : null,
            !r.finished && r.mine
              ? r.started
                ? t("pft.race.progressN", { n: r.doneCount, total: PFT_STATIONS.length })
                : t("pft.race.waiting")
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <RecordRow
              key={r.id}
              href={`/pft/race/${r.code}`}
              title={r.title}
              note={note}
              end={
                r.finished && r.total_ms != null ? (
                  <>
                    {formatMs(r.total_ms)}
                    {badge && <Chip tone="yellow">{t(badgeDictKey(badge))}</Chip>}
                  </>
                ) : undefined
              }
            />
          );
        })}
        <div className="rx-actions" style={{ marginTop: 16 }}>
          {list
            .filter((r) => r.created)
            .slice(0, 3)
            .map((r) => (
              <Go key={r.id} href={`/pft/race/${r.code}/staff`}>
                {t("pft.race.linkStaff")} · {r.title}
              </Go>
            ))}
          {list.slice(0, 3).map((r) => (
            <Go key={`b-${r.id}`} href={`/board/${r.code}`}>
              {t("pft.race.linkBoard")} · {r.title}
            </Go>
          ))}
        </div>
      </Panel>
    );

  return (
    <>
      {section(t("pft.race.sectionOpen"), open)}
      {section(t("pft.race.sectionPast"), past)}
    </>
  );
}
