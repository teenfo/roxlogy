"use client";

import type { ReactNode } from "react";
import { Check, Play, RotateCcw, Undo2 } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { formatMs } from "@/lib/format";
import {
  PFT_STATIONS,
  badgeDictKey,
  pftBadge,
  toNextBadge,
} from "@/lib/pft";
import { fmtClock } from "@/lib/pft-race";
import { PftSplitStrip } from "@/components/pft-splits";
import {
  Back,
  Chip,
  DataTable,
  Hint,
  PageHead,
  Panel,
} from "@/components/rox/ui";

/** DB check 와 같은 하한 (5분) — 이보다 짧으면 기록으로 저장되지 않는다 */
export const PFT_MIN_TOTAL_MS = 300_000;

export type PftBest = { totalMs: number; splits: number[] };

/**
 * PFT 측정 화면(표시 전용) — 시안 racing.tsx 의 PFT(measure) 그대로 (PORT_PLAN §3-d):
 * Back · PageHead · .rx-form-layout[ Panel.rx-stopwatch(단계·시계·현재 종목·버튼·Hint)
 * | Panel "구간 기록" DataTable ]. 일반 측정(/pft/measure)과 레이스 측정(/pft/race/<코드>)이
 * 같은 화면을 쓰고, 상태를 어디에 저장하느냐(브라우저 vs 레이스 서버)만 부모가 다르다.
 *
 * 시안에 없는 우리 정보(예상 완주·구간별 PB·완주 배지)는 Hint 와 표의 PB 열로만 얹는다(§4-1).
 *
 * 시각: startedAt 은 이 기기 시계 기준(ms), splits 는 시작 이후 누적 ms.
 */
export function PftMeasureView({
  startedAt,
  splits,
  now,
  scaled,
  defaultAge,
  best = null,
  busy = false,
  err = null,
  undoDisabled = false,
  resetDisabled = false,
  startDisabled = false,
  completeDisabled = false,
  onStart,
  onComplete,
  onUndo,
  onReset,
  backHref = "/pft",
  title,
  description,
  headerExtra,
  beforeClock,
  clockNote,
  finishExtra,
  afterList,
  hideTimer = false,
}: {
  startedAt: number | null;
  splits: number[];
  now: number;
  scaled: boolean;
  defaultAge: number | null;
  /** 내 최고 기록 — 예상 완주 비율과 구간별 PB 비교용 (없으면 균등 배분) */
  best?: PftBest | null;
  busy?: boolean;
  err?: string | null;
  undoDisabled?: boolean;
  resetDisabled?: boolean;
  startDisabled?: boolean;
  completeDisabled?: boolean;
  onStart: () => void;
  onComplete: () => void;
  onUndo: () => void;
  onReset: () => void;
  backHref?: string;
  title: string;
  /** 설명 문구 — 기본은 상태별(대기·진행·완료) 안내 */
  description?: string;
  /** PageHead 의 action 자리(보드 열기·공유 등) */
  headerExtra?: ReactNode;
  /** 시계 패널 위(참가 카드·알림) */
  beforeClock?: ReactNode;
  /** 시계 패널 안 작은 상태 줄(동기화 대기 등) */
  clockNote?: ReactNode;
  /** 완주 뒤 구간 기록 패널 아래쪽(저장 폼 또는 저장 안내) */
  finishExtra?: ReactNode;
  /** 레이아웃 아래(운영 패널 등) */
  afterList?: ReactNode;
  /** 참가 전처럼 시계·목록을 아직 보이지 않을 때 */
  hideTimer?: boolean;
}) {
  const { t } = useI18n();

  const done = splits.length >= PFT_STATIONS.length;
  const running = startedAt != null && !done;
  const elapsed = startedAt == null ? 0 : Math.max(0, now - startedAt);
  const totalMs = done ? splits[splits.length - 1] : elapsed;
  const current = splits.length; // 지금 수행 중인 종목 인덱스
  const tooShort = done && totalMs < PFT_MIN_TOTAL_MS;
  const badge = done ? pftBadge(totalMs, defaultAge, scaled) : null;
  const next = badge ? toNextBadge(totalMs, defaultAge, scaled) : null;
  const phase = done ? "FINISHED" : running ? "RUNNING" : "READY";

  /** 종목별 비율 — 내 최고 기록이 있으면 그 배분을, 없으면 균등(1/6)을 쓴다 */
  const ratios = best
    ? best.splits.map((v) => v / best.totalMs)
    : PFT_STATIONS.map(() => 1 / PFT_STATIONS.length);

  const stationElapsed = (i: number) =>
    i < splits.length
      ? splits[i] - (i === 0 ? 0 : splits[i - 1])
      : i === current && running
        ? elapsed - (i === 0 ? 0 : splits[i - 1])
        : null;

  /**
   * 예상 완주 — 지금까지 걸린 시간을 "완주 대비 진행 비율"로 나눈다.
   * 진행 비율 = 끝낸 종목 비율 합 + 현재 종목의 진행분(내 최고 기록의 그 종목 시간 대비).
   * 최고 기록이 없으면 끝낸 종목만으로 계산한다(첫 종목 전에는 표시하지 않음).
   */
  const projected = (() => {
    if (!running || elapsed <= 0) return null;
    const doneRatio = ratios.slice(0, current).reduce((a, v) => a + v, 0);
    if (!best) {
      if (current === 0) return null;
      return Math.round(splits[current - 1] / doneRatio);
    }
    const cur = stationElapsed(current) ?? 0;
    const curBest = best.splits[current] || 1;
    const p = Math.min(cur / curBest, 1);
    const frac = doneRatio + p * ratios[current];
    if (frac <= 0.02) return null;
    return Math.round(elapsed / frac);
  })();
  const projBadge = projected != null ? pftBadge(projected, defaultAge, scaled) : null;

  // 시안 시계: "m:ss" + 작은 ".십분의 일초"
  const tenth = Math.floor((totalMs % 1000) / 100);
  const main = fmtClock(totalMs).replace(/\.\d$/, "");

  const stationTitle = (i: number) => `${t(PFT_STATIONS[i].label)} ${t(PFT_STATIONS[i].amount)}`;

  return (
    <>
      <Back href={backHref} label={t("pft.title")} />
      <PageHead
        title={title}
        description={
          description ??
          (done
            ? t("pft.mDoneHint")
            : running
              ? t("pft.mProgress", { n: splits.length, total: PFT_STATIONS.length })
              : t("pft.mDesc"))
        }
        action={headerExtra}
      />

      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {beforeClock}

      {!hideTimer && (
        <div className="rx-form-layout">
          <Panel className="rx-stopwatch">
            <span>{phase}</span>
            <strong>
              {main}
              <small>.{tenth}</small>
            </strong>
            <h2>{done ? t("pft.mAllDone") : stationTitle(current)}</h2>
            <div className="rx-actions">
              {startedAt == null ? (
                <Button
                  className="rx-primary"
                  onClick={onStart}
                  disabled={busy || startDisabled}
                >
                  <Play size={18} /> {t("pft.mStart")}
                </Button>
              ) : done ? (
                <>
                  <Chip tone="green">
                    <Check size={14} />
                    {t("pft.mFinished")}
                  </Chip>
                  {tooShort ? (
                    <Chip tone="red">{t("pft.invalid")}</Chip>
                  ) : (
                    badge && <Chip tone="yellow">{t(badgeDictKey(badge))}</Chip>
                  )}
                </>
              ) : (
                <Button
                  className="rx-primary"
                  onClick={onComplete}
                  disabled={busy || completeDisabled}
                  aria-label={`${stationTitle(current)} ${t("pft.mDone")}`}
                >
                  <Check size={18} /> {t("pft.mDone")}
                </Button>
              )}
              {startedAt != null && (
                <>
                  <Button
                    variant="outline"
                    onClick={onUndo}
                    disabled={!splits.length || busy || undoDisabled}
                  >
                    <Undo2 size={16} /> {t("pft.mUndo")}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={t("pft.mReset")}
                    onClick={onReset}
                    disabled={busy || resetDisabled}
                  >
                    <RotateCcw size={18} />
                  </Button>
                </>
              )}
            </div>
            {clockNote}
            <Hint>
              {running ? (
                <>
                  {t("pft.mNow")} {stationTitle(current)} · {fmtClock(stationElapsed(current) ?? 0)}
                  {projected != null && (
                    <>
                      {" · "}
                      {t("pft.mProjected")} <b>{formatMs(projected)}</b>
                      {projBadge && ` (${t(badgeDictKey(projBadge))} ${t("pft.mPace")})`}
                    </>
                  )}
                </>
              ) : done ? (
                <>
                  {tooShort
                    ? t("pft.errTooShort")
                    : next
                      ? t("pft.toNext", { badge: t(badgeDictKey(next.next)), gap: formatMs(next.gapMs) })
                      : t("pft.topBadge")}
                  {defaultAge == null && ` · ${t("pft.noAgeHint")}`}
                </>
              ) : (
                t("pft.mWakeHint")
              )}
            </Hint>
          </Panel>

          <Panel
            title={t("pft.mSplitsTitle")}
            action={
              done ? (
                <Chip tone="green">{t("pft.mFinished")}</Chip>
              ) : running ? (
                <Chip tone="yellow">
                  {t("pft.mProgress", { n: splits.length, total: PFT_STATIONS.length })}
                </Chip>
              ) : undefined
            }
          >
            <DataTable
              headers={[t("pft.stationCol"), t("pft.timeCol")]}
              rows={PFT_STATIONS.map((st, i) => {
                const finished = i < splits.length;
                const isCurrent = running && i === current;
                const ms = stationElapsed(i);
                const pbMs = best?.splits[i] ?? null;
                const delta = finished && pbMs != null && ms != null ? ms - pbMs : null;
                return [
                  <span key="s" className={finished || isCurrent ? "" : "rx-muted"}>
                    {i + 1}. {t(st.label)}
                    <small className="rx-block rx-muted">{t(st.amount)}</small>
                  </span>,
                  <span key="t">
                    <strong className="rx-number">
                      {ms == null ? "—" : finished ? formatMs(ms) : fmtClock(ms)}
                    </strong>
                    {pbMs != null && (isCurrent || finished) && (
                      <small className="rx-block rx-muted">
                        PB{" "}
                        {delta != null
                          ? `${delta >= 0 ? "+" : "−"}${formatMs(Math.abs(delta))}`
                          : formatMs(pbMs)}
                      </small>
                    )}
                  </span>,
                ];
              })}
            />
            {done && (
              <>
                <div className="rx-summary-time">
                  {formatMs(totalMs)}
                  {badge && !tooShort && <small> {t(badgeDictKey(badge))}</small>}
                </div>
                <PftSplitStrip splits={splits} />
                {finishExtra}
              </>
            )}
          </Panel>
        </div>
      )}

      {afterList}
    </>
  );
}
