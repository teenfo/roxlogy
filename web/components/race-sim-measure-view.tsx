"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { fmtClock } from "@/lib/pft-race";
import { checkpointLabel, type Checkpoint } from "@/lib/race-format";

/**
 * 하이록스 시뮬 레이스의 선수 본인 측정 화면(표시 전용).
 *
 * PftMeasureView 와 같은 콜백·슬롯을 받지만 PFT 전용(배지·예상 완주·종목 규격)은 없다.
 * 구간이 16~32개라 목록은 "지금 구간 + 다음 구간"만 크게 보이고, 지나간 구간은 랩(1~8)별
 * 한 줄로 접는다 — 한 화면에 32줄을 깔면 누를 버튼이 스크롤 밖으로 밀린다.
 *
 * 시각: startedAt 은 이 기기 시계 기준(ms), splits 는 시작 이후 누적 ms.
 */
export function RaceSimMeasureView({
  cps,
  startedAt,
  splits,
  now,
  busy = false,
  err = null,
  startDisabled = false,
  completeDisabled = false,
  undoDisabled = false,
  resetDisabled = false,
  onStart,
  onComplete,
  onUndo,
  onReset,
  title,
  description,
  headerExtra,
  beforeClock,
  clockNote,
  finishExtra,
  afterList,
  hideTimer = false,
}: {
  cps: Checkpoint[];
  startedAt: number | null;
  splits: number[];
  now: number;
  busy?: boolean;
  err?: string | null;
  startDisabled?: boolean;
  completeDisabled?: boolean;
  undoDisabled?: boolean;
  resetDisabled?: boolean;
  onStart: () => void;
  onComplete: () => void;
  onUndo: () => void;
  onReset: () => void;
  title: string;
  description?: string;
  headerExtra?: ReactNode;
  beforeClock?: ReactNode;
  clockNote?: ReactNode;
  finishExtra?: ReactNode;
  afterList?: ReactNode;
  hideTimer?: boolean;
}) {
  const { t } = useI18n();
  const n = cps.length;
  const done = splits.length >= n;
  const running = startedAt != null && !done;
  const elapsed = startedAt == null ? 0 : Math.max(0, now - startedAt);
  const totalMs = done ? splits[n - 1] : elapsed;
  const current = Math.min(splits.length, n - 1);
  const segMs = (i: number) => (i < splits.length ? splits[i] - (i === 0 ? 0 : splits[i - 1]) : null);
  const curElapsed = running ? elapsed - (splits.length ? splits[splits.length - 1] : 0) : 0;

  // 랩(1~8)별 합계 — 지나간 구간을 접어서 보여 준다
  const laps = Array.from({ length: 8 }, (_, k) => {
    const idx = cps.map((cp, i) => (cp.lap === k + 1 ? i : -1)).filter((i) => i >= 0);
    const segs = idx.map((i) => ({ cp: cps[i], i, ms: segMs(i) }));
    const complete = segs.every((s) => s.ms != null);
    const sum = segs.reduce((a, s) => a + (s.ms ?? 0), 0);
    return { lap: k + 1, segs, complete, sum };
  });

  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <Link href="/pft" className="text-[13px] text-muted hover:text-foreground">
          ← {t("pft.title")}
        </Link>
        <h1 className="mt-2 text-[26px] font-extrabold">{title}</h1>
        <p className="mt-1 text-sm text-muted">
          {description ??
            (done ? t("race.simDoneHint") : running ? t("race.progress", { done: splits.length, total: n }) : t("race.simDesc"))}
        </p>
        {headerExtra}
      </div>

      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      {beforeClock}

      {!hideTimer && (
        <>
          {/* 시계 + 지금 구간 — 스크롤해도 보이게 고정 */}
          <div
            className={`sticky top-[72px] z-10 rounded-2xl border px-5 py-4 shadow-[0_12px_30px_rgba(0,0,0,.5)] max-md:top-[60px] ${
              running ? "border-line-accent bg-highlight" : "border-line bg-card"
            }`}
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.1em] text-muted">
                  {done ? "FINISHED" : running ? `${current + 1}/${n}` : "READY"}
                </p>
                <p className={`tabular text-5xl font-black leading-none ${running ? "text-accent" : ""}`}>
                  {done ? formatMs(totalMs) : fmtClock(totalMs)}
                </p>
                {clockNote}
              </div>
              {running && (
                <div className="text-right">
                  <p className="text-sm font-bold" style={{ color: cps[current].color }}>
                    {checkpointLabel(t, cps[current])}
                  </p>
                  <p className="tabular text-2xl font-extrabold">{fmtClock(curElapsed)}</p>
                </div>
              )}
            </div>

            {/* 구간 진행 — 이어 붙인 가는 칸 */}
            <div className="mt-3 flex gap-[2px]" aria-label={t("race.progress", { done: splits.length, total: n })}>
              {cps.map((cp, i) => (
                <span
                  key={cp.key}
                  className={`h-2 flex-1 rounded-sm ${i === current && running ? "motion-safe:animate-pulse" : ""}`}
                  style={{ background: i < splits.length || (i === current && running) ? cp.color : "var(--line)" }}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {startedAt == null ? (
                <button
                  type="button"
                  onClick={onStart}
                  disabled={busy || startDisabled}
                  className="h-14 flex-1 rounded-xl bg-accent px-6 text-lg font-black text-background hover:brightness-110 disabled:opacity-40"
                >
                  {t("pft.mStart")}
                </button>
              ) : running ? (
                <button
                  type="button"
                  onClick={onComplete}
                  disabled={completeDisabled}
                  style={{ background: cps[current].color }}
                  className="flex h-16 flex-1 flex-col items-center justify-center rounded-xl text-[#141414] hover:brightness-110 active:brightness-95 disabled:opacity-40"
                >
                  <span className="text-[11px] font-bold opacity-80">{t("race.tapHint", { n: current + 1, total: n })}</span>
                  <span className="text-xl font-black">{t("pft.race.staffTap", { station: checkpointLabel(t, cps[current]) })} ✓</span>
                </button>
              ) : null}
              {startedAt != null && (
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={onUndo}
                    disabled={busy || undoDisabled || splits.length === 0}
                    className="h-14 rounded-xl border border-line-strong bg-control px-4 text-sm font-semibold disabled:opacity-40"
                  >
                    ↶ {t("pft.mUndo")}
                  </button>
                  {!done && (
                    <button
                      type="button"
                      onClick={onReset}
                      disabled={busy || resetDisabled}
                      className="h-14 rounded-xl border border-line-strong bg-control px-4 text-sm font-semibold text-muted disabled:opacity-40"
                    >
                      {t("pft.mReset")}
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* 랩별 기록 — 지난 구간을 한 줄로 */}
          <ol className="flex flex-col gap-1.5">
            {laps.map((l) => {
              const active = running && l.segs.some((s) => s.i === current);
              return (
                <li
                  key={l.lap}
                  className={`rounded-xl border px-4 py-2.5 ${
                    active ? "border-line-accent bg-highlight" : l.complete ? "border-line bg-card" : "border-[#1c1c1c] bg-card opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="tabular w-5 text-sm font-extrabold text-muted">{l.lap}</span>
                      <span className="truncate text-sm font-bold">
                        {checkpointLabel(t, l.segs.find((s) => s.cp.kind === "station")!.cp)}
                      </span>
                    </span>
                    <span className="tabular text-sm font-extrabold">{l.complete ? formatMs(l.sum) : "—"}</span>
                  </div>
                  {l.segs.some((s) => s.ms != null) && (
                    <p className="tabular mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                      {l.segs.map((s) => (
                        <span key={s.cp.key}>
                          <span style={{ color: s.cp.color }}>●</span> {checkpointLabel(t, s.cp)} {s.ms != null ? formatMs(s.ms) : "—"}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {done && (
            <section className="rounded-2xl border border-line-accent bg-highlight px-6 py-5">
              <p className="text-xs font-bold tracking-[0.1em] text-accent">{t("race.simFinished")}</p>
              <p className="tabular mt-1 text-4xl font-black">{formatMs(totalMs)}</p>
              {finishExtra}
            </section>
          )}
        </>
      )}

      {afterList}
    </div>
  );
}
