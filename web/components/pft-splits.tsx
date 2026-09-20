"use client";

import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { PFT_COLORS, PFT_STATIONS } from "@/lib/pft";
import { segmentMs } from "@/lib/pft-race";

/**
 * 6개 종목 구간 띠 — 시안 pft-race.tsx 의 StageStrip 그대로(.rx-pft-splits).
 * 찍힌 구간만 종목 색을 칠하고 아래에 구간 시간을 적는다. 스태프·라이브보드·
 * 측정 화면이 같은 것을 쓴다(라이브보드 안에서는 .rx-live-board 가 색을 덮는다).
 *
 * @param splits 시작 이후 누적 ms 배열(0~6개)
 */
export function PftSplitStrip({ splits }: { splits: number[] }) {
  const { t } = useI18n();
  return (
    <div
      className="rx-pft-splits"
      aria-label={t("pft.race.progressLabel", { done: splits.length })}
    >
      {PFT_STATIONS.map((st, i) => {
        const ms = segmentMs(splits, i);
        return (
          <div key={st.key}>
            <span
              title={t(st.label)}
              style={{ background: ms != null ? PFT_COLORS[st.key] : undefined }}
            />
            <small>{ms != null ? formatMs(ms) : "—"}</small>
          </div>
        );
      })}
    </div>
  );
}
