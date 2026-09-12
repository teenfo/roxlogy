"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import {
  PFT_COLORS,
  PFT_STATIONS,
  badgeClass,
  badgeDictKey,
  badgeText,
  pftBadge,
  toNextBadge,
} from "@/lib/pft";
import { fmtClock } from "@/lib/pft-race";

/** DB check 와 같은 하한 (5분) — 이보다 짧으면 기록으로 저장되지 않는다 */
export const PFT_MIN_TOTAL_MS = 300_000;

export type PftBest = { totalMs: number; splits: number[] };

/**
 * PFT 측정 화면(표시 전용) — 일반 측정(/pft/measure)과 레이스 측정(/pft/race/<코드>)이
 * 같은 화면을 쓴다. 시계·종목 목록·완주 카드는 여기 한 곳에만 있고, 상태를 어디에 저장하느냐
 * (브라우저 vs 레이스 서버)만 부모가 다르다.
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
  /** 제목 옆·아래에 붙는 부가 정보(레이스 코드·보드 버튼 등) */
  headerExtra?: ReactNode;
  /** 시계 카드 위(참가 카드·알림) */
  beforeClock?: ReactNode;
  /** 시계 카드 안 작은 상태 줄(동기화 대기 등) */
  clockNote?: ReactNode;
  /** 완주 카드 아래쪽(저장 폼 또는 저장 안내) */
  finishExtra?: ReactNode;
  /** 종목 목록 아래(운영 카드 등) */
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

  return (
    <div className="flex flex-col gap-[18px]">
      {/* 헤더 */}
      <div>
        <Link href={backHref} className="text-[13px] text-muted hover:text-foreground">
          ← {t("pft.title")}
        </Link>
        <h1 className="mt-2 text-[26px] font-extrabold">{title}</h1>
        <p className="mt-1 text-sm text-muted">
          {description ??
            (done
              ? t("pft.mDoneHint")
              : running
                ? t("pft.mProgress", { n: splits.length, total: PFT_STATIONS.length })
                : t("pft.mDesc"))}
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
          {/* 시계 카드 — 스크롤해도 항상 보이게 고정 */}
          <div
            className={`sticky top-[72px] z-10 rounded-2xl border px-5 py-4 shadow-[0_12px_30px_rgba(0,0,0,.5)] max-md:top-[60px] ${
              running ? "border-line-accent bg-highlight" : "border-line bg-card"
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p className={`text-xs font-extrabold tracking-[0.08em] ${running ? "text-accent" : "text-muted"}`}>
                  {phase}
                </p>
                <p
                  className={`tabular text-[56px] font-extrabold leading-none tracking-tight ${running ? "text-accent" : ""}`}
                >
                  {startedAt == null ? "0:00.0" : done ? formatMs(totalMs) : fmtClock(totalMs)}
                </p>
              </div>

              <div className="min-w-[150px] flex-1 text-[13px] text-muted">
                {running ? (
                  <>
                    <p>
                      {t("pft.mNow")}{" "}
                      <b className="font-bold text-foreground">{t(PFT_STATIONS[current].label)}</b> ·{" "}
                      {fmtClock(stationElapsed(current) ?? 0)}
                    </p>
                    {projected != null && (
                      <p className="mt-0.5">
                        {t("pft.mProjected")}{" "}
                        <b className="tabular font-bold text-foreground">{formatMs(projected)}</b>
                        {projBadge && (
                          <span className={`ml-1.5 font-bold ${badgeText(projBadge)}`}>
                            {t(badgeDictKey(projBadge))} {t("pft.mPace")}
                          </span>
                        )}
                      </p>
                    )}
                  </>
                ) : done ? (
                  <>
                    <p>
                      {PFT_STATIONS.length}/{PFT_STATIONS.length} ·{" "}
                      {badge && <b className={`font-bold ${badgeText(badge)}`}>{t(badgeDictKey(badge))}</b>}
                    </p>
                    {next && (
                      <p className="mt-0.5">
                        {t("pft.toNext", { badge: t(badgeDictKey(next.next)), gap: formatMs(next.gapMs) })}
                      </p>
                    )}
                  </>
                ) : (
                  <p>{t("pft.mWakeHint")}</p>
                )}
                {clockNote}
              </div>

              {startedAt == null ? (
                <button
                  type="button"
                  onClick={onStart}
                  disabled={busy || startDisabled}
                  className="h-14 rounded-xl bg-accent px-9 text-lg font-black text-background hover:brightness-110 disabled:opacity-40 max-sm:w-full sm:ml-auto"
                >
                  ▶ {t("pft.mStart")}
                </button>
              ) : (
                <span className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onUndo}
                    disabled={!splits.length || busy || undoDisabled}
                    className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-muted/60 disabled:opacity-40"
                  >
                    ↶ {t("pft.mUndo")}
                  </button>
                  <button
                    type="button"
                    onClick={onReset}
                    disabled={busy || resetDisabled}
                    className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-danger-line-strong hover:text-danger disabled:opacity-40"
                  >
                    {t("pft.mReset")}
                  </button>
                </span>
              )}
            </div>

            {/* 진행 바 — 6칸 */}
            <div className="mt-3 grid grid-cols-6 gap-1" aria-hidden>
              {PFT_STATIONS.map((st, i) => (
                <span
                  key={st.key}
                  className={`h-1.5 rounded-full ${
                    i < splits.length ? "bg-success" : running && i === current ? "bg-accent" : "bg-[#2a2a2a]"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* 종목 리스트 */}
          <ol className="flex flex-col gap-2">
            {PFT_STATIONS.map((st, i) => {
              const finished = i < splits.length;
              const isCurrent = running && i === current;
              const ms = stationElapsed(i);
              const pbMs = best?.splits[i] ?? null;
              const delta = finished && pbMs != null && ms != null ? ms - pbMs : null;

              return (
                <li
                  key={st.key}
                  className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-2xl border px-4 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-4 sm:px-5 ${
                    isCurrent
                      ? "border-accent bg-highlight py-4"
                      : finished
                        ? "border-line bg-card py-3"
                        : "border-[#1c1c1c] bg-card py-3 opacity-50"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold ${
                      isCurrent
                        ? "bg-accent text-background"
                        : finished
                          ? "bg-success-bg text-success"
                          : "bg-line text-muted"
                    }`}
                  >
                    {i + 1}
                  </span>

                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`truncate font-bold ${isCurrent ? "text-xl" : "text-[15px]"}`}>
                        {t(st.label)}
                      </span>
                      <span className="text-[13px] font-bold text-foreground/80">{t(st.amount)}</span>
                    </span>
                    {t(st.detail) && <span className="block truncate text-xs text-muted">{t(st.detail)}</span>}
                  </span>

                  <span className="flex shrink-0 items-center justify-between gap-3 max-sm:col-span-2 max-sm:mt-1">
                    <span className="text-right">
                      <span
                        className={`tabular block font-extrabold ${
                          isCurrent ? "text-[26px] text-accent" : finished ? "text-base" : "text-base text-[#444]"
                        }`}
                      >
                        {ms == null ? "—" : finished ? formatMs(ms) : fmtClock(ms)}
                      </span>
                      {isCurrent && pbMs != null && (
                        <span className="tabular block text-xs text-muted">PB {formatMs(pbMs)}</span>
                      )}
                      {finished && delta != null && (
                        <span className={`tabular block text-xs ${delta > 0 ? "text-muted" : "text-success"}`}>
                          PB {delta >= 0 ? "+" : "−"}
                          {formatMs(Math.abs(delta))}
                        </span>
                      )}
                    </span>

                    {finished ? (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success-bg text-success">
                        ✓
                      </span>
                    ) : isCurrent ? (
                      <button
                        type="button"
                        onClick={onComplete}
                        disabled={completeDisabled}
                        className="h-14 rounded-xl bg-accent px-6 text-lg font-black text-background hover:brightness-110 disabled:opacity-40 max-sm:flex-1 sm:px-8"
                      >
                        {t("pft.mDone")} ✓
                      </button>
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-xs text-muted-3">
                        {i + 1}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* 완주 카드 */}
          {done && (
            <section className="rounded-2xl border border-line-accent bg-highlight px-6 py-5">
              <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div>
                  <p className="text-xs font-extrabold tracking-[0.08em] text-accent">FINISHED</p>
                  <p className="tabular mt-1 flex flex-wrap items-center gap-3 text-[48px] font-extrabold leading-none text-accent">
                    {formatMs(totalMs)}
                    {tooShort ? (
                      <span className="rounded-md bg-danger-bg px-2 py-1 text-xs font-bold text-danger">
                        {t("pft.invalid")}
                      </span>
                    ) : (
                      badge && (
                        <span className={`rounded-md px-2.5 py-1 text-xs font-extrabold ${badgeClass(badge)}`}>
                          {t(badgeDictKey(badge))}
                        </span>
                      )
                    )}
                  </p>
                  {!tooShort && next && (
                    <p className="mt-2 text-xs text-muted">
                      {t("pft.toNext", { badge: t(badgeDictKey(next.next)), gap: formatMs(next.gapMs) })}
                    </p>
                  )}
                  {defaultAge == null && <p className="mt-1 text-xs text-muted">{t("pft.noAgeHint")}</p>}
                </div>

                {/* 스플릿 스택 바 */}
                <div className="min-w-0 self-center">
                  <div className="flex h-3.5 overflow-hidden rounded-full">
                    {PFT_STATIONS.map((st, i) => {
                      const ms = splits[i] - (i === 0 ? 0 : splits[i - 1]);
                      return (
                        <span
                          key={st.key}
                          title={`${t(st.label)} ${formatMs(ms)}`}
                          style={{ width: `${(ms / totalMs) * 100}%`, background: PFT_COLORS[st.key] }}
                          className="mr-0.5 last:mr-0"
                        />
                      );
                    })}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {PFT_STATIONS.map((st, i) => (
                      <li key={st.key} className="flex items-center gap-1 text-xs">
                        <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: PFT_COLORS[st.key] }} />
                        <span className="text-muted">{t(st.label)}</span>
                        <span className="tabular font-semibold">
                          {formatMs(splits[i] - (i === 0 ? 0 : splits[i - 1]))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {finishExtra}
            </section>
          )}
        </>
      )}

      {afterList}
    </div>
  );
}
