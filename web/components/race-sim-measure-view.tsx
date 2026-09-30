"use client";

import type { ComponentProps } from "react";
import { Check, Play, RotateCcw, Undo2 } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import type { PftMeasureView } from "@/components/pft-measure-view";
import { PftSplitStrip } from "@/components/pft-splits";
import { Back, Chip, Hint, PageHead, Panel } from "@/components/rox/ui";
import { formatMs } from "@/lib/format";
import { fmtClock, segmentMs } from "@/lib/pft-race";
import { checkpointLabel, type Checkpoint } from "@/lib/race-format";

type Props = Omit<ComponentProps<typeof PftMeasureView>, "scaled" | "defaultAge" | "best"> & { cps: Checkpoint[] };

/** Simulation uses the same RPC queue as PFT, with 8 folded laps and no PFT badges. */
export function RaceSimMeasureView({
  cps, startedAt, splits, now, busy = false, err = null,
  startDisabled = false, completeDisabled = false, undoDisabled = false, resetDisabled = false,
  onStart, onComplete, onUndo, onReset, title, description, headerExtra, beforeClock,
  clockNote, finishExtra, afterList, hideTimer = false,
}: Props) {
  const { t } = useI18n();
  const done = splits.length >= cps.length;
  const running = startedAt != null && !done;
  const current = Math.min(splits.length, cps.length - 1);
  const elapsed = startedAt == null ? 0 : Math.max(0, now - startedAt);
  const total = done ? splits[cps.length - 1] : elapsed;
  const clock = fmtClock(total);
  const curElapsed = Math.max(0, elapsed - (splits.at(-1) ?? 0));
  const laps = Array.from({ length: 8 }, (_, i) => {
    const segs = cps.map((cp, index) => ({ cp, index, ms: segmentMs(splits, index) })).filter((s) => s.cp.lap === i + 1);
    return { lap: i + 1, segs, complete: segs.every((s) => s.ms != null), sum: segs.reduce((a, s) => a + (s.ms ?? 0), 0) };
  });

  return (
    <>
      <Back href="/timing" label={t("timing.title")} />
      <PageHead title={title} description={description ?? (done ? t("race.simFinished") : running ? t("race.progress", { done: splits.length, total: cps.length }) : t("race.simDesc"))} action={headerExtra} />
      {err && <p role="alert" className="rx-error">{err}</p>}
      {beforeClock}
      {!hideTimer && (
        <div className="rx-form-layout rx-sim-measure">
          <Panel className="rx-stopwatch rx-sim-clock">
            <span>{done ? "FINISHED" : running ? `${current + 1}/${cps.length}` : "READY"}</span>
            <strong>{clock.replace(/\.\d$/, "")}<small>{clock.slice(-2)}</small></strong>
            <h2>{done ? t("race.simFinished") : checkpointLabel(t, cps[current])}</h2>
            <PftSplitStrip splits={splits} cps={cps} current={running ? current : undefined} />
            <div className="rx-actions">
              {startedAt == null ? (
                <Button className="rx-primary" onClick={onStart} disabled={busy || startDisabled}><Play size={18} /> {t("pft.mStart")}</Button>
              ) : running ? (
                <Button className="rx-primary rx-sim-tap" onClick={onComplete} disabled={completeDisabled}>
                  <Check size={18} /> {t("pft.race.staffTap", { station: checkpointLabel(t, cps[current]) })}
                </Button>
              ) : <Chip tone="green">{t("race.simFinished")}</Chip>}
              {startedAt != null && <>
                <Button variant="outline" onClick={onUndo} disabled={!splits.length || busy || undoDisabled}><Undo2 size={16} /> {t("pft.mUndo")}</Button>
                {!done && <Button variant="ghost" aria-label={t("pft.mReset")} onClick={onReset} disabled={busy || resetDisabled}><RotateCcw size={18} /></Button>}
              </>}
            </div>
            {clockNote}
            <Hint>{running ? `${t("race.tapHint", { n: current + 1, total: cps.length })} · ${fmtClock(curElapsed)}` : done ? t("race.simFinished") : t("race.simDesc")}</Hint>
          </Panel>
          <Panel title={t("pft.mSplitsTitle")} action={<Chip>{t("race.progress", { done: Math.min(splits.length, cps.length), total: cps.length })}</Chip>}>
            <ol className="rx-sim-laps">
              {laps.map((lap) => {
                const station = lap.segs.find((s) => s.cp.kind === "station");
                const active = running && lap.segs.some((s) => s.index === current);
                return <li key={lap.lap} className={active ? "active" : lap.complete ? "complete" : ""}>
                  <div><b>{lap.lap}. {station ? checkpointLabel(t, station.cp) : "—"}</b><strong className="rx-number">{lap.complete ? formatMs(lap.sum) : "—"}</strong></div>
                  {lap.segs.some((s) => s.ms != null) && <p>{lap.segs.map((s) => <span key={s.cp.key}>{checkpointLabel(t, s.cp)} {s.ms == null ? "—" : formatMs(s.ms)}</span>)}</p>}
                </li>;
              })}
            </ol>
            {done && <><div className="rx-summary-time">{formatMs(total)}</div>{finishExtra}</>}
          </Panel>
        </div>
      )}
      {afterList}
    </>
  );
}
