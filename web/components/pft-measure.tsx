"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

/** 진행 중인 측정을 브라우저에 남긴다 — 25분짜리라 실수로 새로고침하거나
 *  전화가 와서 앱이 내려가면 기록이 통째로 날아간다. */
const KEY = "roxlogy.pft.measure.v1";
const MIN_TOTAL_MS = 300_000; // DB check 와 같은 하한 (5분)

type Saved = { startedAt: number; splits: number[] };

/** 러닝 클록은 0.1초까지 — 정지 상태에선 formatMs(mm:ss)를 쓴다. */
function fmtClock(ms: number): string {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

export function PftMeasure({
  defaultAge,
  defaultGender,
  best = null,
}: {
  defaultAge: number | null;
  defaultGender: string | null;
  /** 내 최고 기록 — 예상 완주 비율과 구간별 PB 비교용 (없으면 균등 배분) */
  best?: { totalMs: number; splits: number[] } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** 각 종목을 끝낸 시점의 "시작 이후 누적 ms". PFT 는 쉬지 않으므로 누적으로 둔다. */
  const [splits, setSplits] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [scaled, setScaled] = useState(false);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const done = splits.length >= PFT_STATIONS.length;
  const running = startedAt != null && !done;
  const elapsed = startedAt == null ? 0 : now - startedAt;
  const totalMs = done ? splits[splits.length - 1] : elapsed;

  // 중단된 측정 복구. localStorage 는 외부 저장소라 서버 렌더에서 읽을 수 없고,
  // useState 초기값으로 읽으면 하이드레이션이 어긋난다 — 마운트 후 한 번만 읽는다.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as Saved;
      if (typeof v?.startedAt === "number" && Array.isArray(v.splits)) {
        /* eslint-disable react-hooks/set-state-in-effect */
        setStartedAt(v.startedAt);
        setSplits(v.splits.filter((x) => typeof x === "number"));
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      /* 저장소를 못 읽으면 그냥 새로 시작한다 */
    }
  }, []);

  // 진행 상태를 저장소에 반영 (setState 없음 — 외부 시스템 쓰기만)
  useEffect(() => {
    try {
      if (startedAt == null) window.localStorage.removeItem(KEY);
      else
        window.localStorage.setItem(
          KEY,
          JSON.stringify({ startedAt, splits } satisfies Saved),
        );
    } catch {
      /* 사파리 프라이빗 모드 등 — 저장 실패해도 측정은 계속된다 */
    }
  }, [startedAt, splits]);

  // 시계는 Date.now() 차이로 계산한다 — 탭이 백그라운드로 가서 타이머가
  // 늦게 돌아도 경과 시간이 밀리지 않는다.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  // 측정 중 화면이 꺼지지 않게 (지원하는 브라우저만)
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (!("wakeLock" in navigator) || document.visibilityState !== "visible")
          return;
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) void s.release();
        else wakeRef.current = s;
      } catch {
        /* 화면 유지 못 해도 측정에는 지장 없다 */
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void wakeRef.current?.release().catch(() => {});
      wakeRef.current = null;
    };
  }, [running]);

  const start = () => {
    setErr(null);
    setSplits([]);
    setNow(Date.now());
    setStartedAt(Date.now());
  };
  const complete = useCallback(() => {
    if (startedAt == null) return;
    setSplits((p) =>
      p.length >= PFT_STATIONS.length ? p : [...p, Date.now() - startedAt],
    );
  }, [startedAt]);
  const undo = () => setSplits((p) => p.slice(0, -1));
  const reset = () => {
    if (splits.length && !window.confirm(t("pft.resetConfirm"))) return;
    setStartedAt(null);
    setSplits([]);
    setErr(null);
  };

  async function save() {
    if (!done) return;
    if (totalMs < MIN_TOTAL_MS) return setErr(t("pft.errTooShort"));
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }
    const payload: Record<string, unknown> = {
      user_id: u.user.id,
      tested_on: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
      total_ms: totalMs,
      age: defaultAge,
      gender: defaultGender,
      scaled,
      location: location.trim() || null,
      shared: true,
    };
    // 누적 → 구간 시간
    PFT_STATIONS.forEach((s, i) => {
      payload[s.col] = splits[i] - (i === 0 ? 0 : splits[i - 1]);
    });
    const { error } = await supabase.from("pft_results").insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
    router.push("/pft");
    router.refresh();
  }

  const badge = done ? pftBadge(totalMs, defaultAge, scaled) : null;
  const next = badge ? toNextBadge(totalMs, defaultAge, scaled) : null;
  const current = splits.length; // 지금 수행 중인 종목 인덱스
  const tooShort = done && totalMs < MIN_TOTAL_MS;

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
   * 진행 비율 = 끝낸 종목 비율 합 + 현재 종목의 진행분.
   * 현재 종목 진행분은 내 최고 기록의 그 종목 시간과 견줘 추정하므로,
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
  const projBadge =
    projected != null ? pftBadge(projected, defaultAge, scaled) : null;

  const phase = done ? "FINISHED" : running ? "RUNNING" : "READY";

  return (
    <div className="flex flex-col gap-[18px]">
      {/* 헤더 */}
      <div>
        <Link href="/pft" className="text-[13px] text-muted hover:text-foreground">
          ← {t("pft.title")}
        </Link>
        <h1 className="mt-2 text-[26px] font-extrabold">{t("pft.mTitle")}</h1>
        <p className="mt-1 text-sm text-muted">
          {done
            ? t("pft.mDoneHint")
            : running
              ? t("pft.mProgress", {
                  n: splits.length,
                  total: PFT_STATIONS.length,
                })
              : t("pft.mDesc")}
        </p>
      </div>

      {/* 시계 카드 — 스크롤해도 항상 보이게 고정 */}
      <div
        className={`sticky top-[72px] z-10 rounded-2xl border px-5 py-4 shadow-[0_12px_30px_rgba(0,0,0,.5)] max-md:top-[60px] ${
          running ? "border-line-accent bg-highlight" : "border-line bg-card"
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p
              className={`text-[11px] font-extrabold tracking-[0.08em] ${running ? "text-accent" : "text-muted"}`}
            >
              {phase}
            </p>
            <p
              className={`tabular text-[56px] font-extrabold leading-none tracking-tight ${running ? "text-accent" : ""}`}
            >
              {startedAt == null
                ? "0:00.0"
                : done
                  ? formatMs(totalMs)
                  : fmtClock(totalMs)}
            </p>
          </div>

          <div className="min-w-[150px] flex-1 text-[13px] text-muted">
            {running ? (
              <>
                <p>
                  {t("pft.mNow")}{" "}
                  <b className="font-bold text-foreground">
                    {t(PFT_STATIONS[current].label)}
                  </b>{" "}
                  · {fmtClock(stationElapsed(current) ?? 0)}
                </p>
                {projected != null && (
                  <p className="mt-0.5">
                    {t("pft.mProjected")}{" "}
                    <b className="tabular font-bold text-foreground">
                      {formatMs(projected)}
                    </b>
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
                  {badge && (
                    <b className={`font-bold ${badgeText(badge)}`}>
                      {t(badgeDictKey(badge))}
                    </b>
                  )}
                </p>
                {next && (
                  <p className="mt-0.5">
                    {t("pft.toNext", {
                      badge: t(badgeDictKey(next.next)),
                      gap: formatMs(next.gapMs),
                    })}
                  </p>
                )}
              </>
            ) : (
              <p>{t("pft.mWakeHint")}</p>
            )}
          </div>

          {startedAt == null ? (
            <button
              type="button"
              onClick={start}
              className="h-14 rounded-xl bg-accent px-9 text-lg font-black text-background hover:brightness-110 max-sm:w-full sm:ml-auto"
            >
              ▶ {t("pft.mStart")}
            </button>
          ) : (
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={undo}
                disabled={!splits.length || busy}
                className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-muted/60 disabled:opacity-40"
              >
                ↶ {t("pft.mUndo")}
              </button>
              <button
                type="button"
                onClick={reset}
                className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-danger-line-strong hover:text-danger"
              >
                {t("pft.mReset")}
              </button>
            </span>
          )}
        </div>

        {/* 진행 바 — 6칸 */}
        <div className="mt-3 grid grid-cols-6 gap-1">
          {PFT_STATIONS.map((st, i) => (
            <span
              key={st.key}
              className={`h-1.5 rounded-full ${
                i < splits.length
                  ? "bg-success"
                  : running && i === current
                    ? "bg-accent"
                    : "bg-[#2a2a2a]"
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
          const delta = finished && pbMs != null ? ms! - pbMs : null;

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
                  <span
                    className={`truncate font-bold ${isCurrent ? "text-xl" : "text-[15px]"}`}
                  >
                    {t(st.label)}
                  </span>
                  <span className="text-[13px] font-bold text-foreground/80">
                    {t(st.amount)}
                  </span>
                </span>
                {t(st.detail) && (
                  <span className="block truncate text-xs text-muted">
                    {t(st.detail)}
                  </span>
                )}
              </span>

              <span className="flex shrink-0 items-center justify-between gap-3 max-sm:col-span-2 max-sm:mt-1">
                <span className="text-right">
                  <span
                    className={`tabular block font-extrabold ${
                      isCurrent
                        ? "text-[26px] text-accent"
                        : finished
                          ? "text-base"
                          : "text-base text-[#444]"
                    }`}
                  >
                    {ms == null
                      ? "—"
                      : finished
                        ? formatMs(ms)
                        : fmtClock(ms)}
                  </span>
                  {isCurrent && pbMs != null && (
                    <span className="tabular block text-[11px] text-muted">
                      PB {formatMs(pbMs)}
                    </span>
                  )}
                  {finished && delta != null && (
                    <span
                      className={`tabular block text-[11px] ${delta > 0 ? "text-muted" : "text-success"}`}
                    >
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
                    onClick={complete}
                    className="h-14 rounded-xl bg-accent px-6 text-lg font-black text-background hover:brightness-110 max-sm:flex-1 sm:px-8"
                  >
                    {t("pft.mDone")} ✓
                  </button>
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-xs text-[#555]">
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
              <p className="text-[11px] font-extrabold tracking-[0.08em] text-accent">
                FINISHED
              </p>
              <p className="tabular mt-1 flex flex-wrap items-center gap-3 text-[48px] font-extrabold leading-none text-accent">
                {formatMs(totalMs)}
                {tooShort ? (
                  <span className="rounded-md bg-danger-bg px-2 py-1 text-xs font-bold text-danger">
                    {t("pft.invalid")}
                  </span>
                ) : (
                  badge && (
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-extrabold ${badgeClass(badge)}`}
                    >
                      {t(badgeDictKey(badge))}
                    </span>
                  )
                )}
              </p>
              {!tooShort && next && (
                <p className="mt-2 text-xs text-muted">
                  {t("pft.toNext", {
                    badge: t(badgeDictKey(next.next)),
                    gap: formatMs(next.gapMs),
                  })}
                </p>
              )}
              {defaultAge == null && (
                <p className="mt-1 text-[11px] text-muted">{t("pft.noAgeHint")}</p>
              )}
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
                      style={{
                        width: `${(ms / totalMs) * 100}%`,
                        background: PFT_COLORS[st.key],
                      }}
                      className="mr-0.5 last:mr-0"
                    />
                  );
                })}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {PFT_STATIONS.map((st, i) => (
                  <li key={st.key} className="flex items-center gap-1 text-[11px]">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-sm"
                      style={{ background: PFT_COLORS[st.key] }}
                    />
                    <span className="text-muted">{t(st.label)}</span>
                    <span className="tabular font-semibold">
                      {formatMs(splits[i] - (i === 0 ? 0 : splits[i - 1]))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 grid gap-3 border-t border-[#3a3200] pt-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-muted">{t("pft.fLocation")}</span>
              <input
                className="mt-1 h-10 w-full rounded-lg border border-[#444] bg-page px-3 text-sm outline-none focus:border-accent"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={80}
                placeholder={t("pft.fLocationPh")}
              />
            </label>
            <label className="flex items-start gap-2 self-end pb-1 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-accent"
                checked={scaled}
                onChange={(e) => setScaled(e.target.checked)}
              />
              <span>
                {t("pft.fScaled")}
                <span className="block text-xs text-muted">
                  {t("pft.fScaledHint")}
                </span>
              </span>
            </label>
          </div>

          {err && <p className="mt-3 text-sm text-danger">{err}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || tooShort}
              className={`h-11 rounded-lg px-6 text-[15px] font-extrabold ${
                tooShort
                  ? "cursor-not-allowed bg-[#2a2a2a] text-[#666]"
                  : "bg-accent text-background hover:brightness-110"
              } disabled:opacity-60`}
            >
              {busy ? t("common.saving") : t("pft.mSave")}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-[13px] text-muted hover:text-danger"
            >
              {t("pft.mDiscard")}
            </button>
            <p
              className={`ml-auto text-xs ${tooShort ? "text-danger" : "text-muted"}`}
            >
              {tooShort ? t("pft.errTooShort") : t("pft.mSaveHint")}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
