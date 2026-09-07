"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import {
  PFT_STATIONS,
  badgeClass,
  badgeDictKey,
  pftBadge,
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
}: {
  defaultAge: number | null;
  defaultGender: string | null;
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
  const current = splits.length; // 지금 수행 중인 종목 인덱스

  return (
    <div>
      {/* 클록 + 시작/초기화 — 화면 맨 위에 고정해 스크롤해도 보이게 */}
      <div className="sticky top-0 z-10 -mx-1 rounded-md bg-surface px-5 py-4 shadow-lg shadow-background/60">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={`font-mono text-4xl font-black tabular-nums ${
              running ? "text-accent" : ""
            }`}
          >
            {startedAt == null ? "0:00.0" : fmtClock(totalMs)}
          </span>

          {startedAt == null ? (
            <button
              type="button"
              onClick={start}
              className="ml-auto rounded-md bg-accent px-8 py-3 text-base font-black text-background hover:brightness-110"
            >
              {t("pft.mStart")}
            </button>
          ) : (
            <span className="ml-auto flex items-center gap-3">
              {splits.length > 0 && !busy && (
                <button
                  type="button"
                  onClick={undo}
                  className="text-xs text-muted hover:text-foreground"
                >
                  {t("pft.mUndo")}
                </button>
              )}
              <button
                type="button"
                onClick={reset}
                className="text-xs text-muted hover:text-red-400"
              >
                {t("pft.mReset")}
              </button>
            </span>
          )}
        </div>
        {running && (
          <p className="mt-1 text-xs text-muted">
            {t("pft.mProgress", {
              n: splits.length,
              total: PFT_STATIONS.length,
            })}
          </p>
        )}
      </div>

      {/* 종목 리스트 — 현재 종목만 완료 버튼이 활성화된다 */}
      <ol className="mt-4 flex flex-col gap-2">
        {PFT_STATIONS.map((s, i) => {
          const finished = i < splits.length;
          const isCurrent = running && i === current;
          const stationMs = finished
            ? splits[i] - (i === 0 ? 0 : splits[i - 1])
            : isCurrent
              ? elapsed - (i === 0 ? 0 : splits[i - 1])
              : null;
          return (
            <li
              key={s.key}
              className={`rounded-md px-4 py-3 ${
                isCurrent
                  ? "bg-accent/10 ring-1 ring-accent/50"
                  : finished
                    ? "bg-surface"
                    : "bg-surface opacity-50"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-5 shrink-0 font-mono text-sm text-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {t(s.label)}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {t(s.spec)}
                  </span>
                </span>

                {stationMs != null && (
                  <span
                    className={`shrink-0 font-mono text-sm tabular-nums ${
                      finished ? "font-bold" : "text-muted"
                    }`}
                  >
                    {finished ? formatMs(stationMs) : fmtClock(stationMs)}
                  </span>
                )}

                {finished ? (
                  <span className="shrink-0 text-lg text-accent">✓</span>
                ) : (
                  <button
                    type="button"
                    onClick={complete}
                    disabled={!isCurrent}
                    className="shrink-0 rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110 disabled:bg-background disabled:text-muted"
                  >
                    {t("pft.mDone")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* 완주 후 저장 */}
      {done && (
        <section className="mt-5 rounded-md border border-accent/40 bg-accent/5 px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-sm text-muted">{t("pft.mFinished")}</span>
            <span className="font-mono text-3xl font-black">
              {formatMs(totalMs)}
            </span>
            {badge && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeClass(badge)}`}
              >
                {t(badgeDictKey(badge))}
              </span>
            )}
          </div>
          {defaultAge == null && (
            <p className="mt-1 text-[11px] text-muted">{t("pft.noAgeHint")}</p>
          )}

          <label className="mt-3 block text-xs text-muted">
            {t("pft.fLocation")}
          </label>
          <input
            className="mt-1 w-full max-w-sm rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={80}
            placeholder={t("pft.fLocationPh")}
          />

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={scaled}
              onChange={(e) => setScaled(e.target.checked)}
            />
            <span>
              {t("pft.fScaled")}
              <span className="mt-0.5 block text-[11px] text-muted">
                {t("pft.fScaledHint")}
              </span>
            </span>
          </label>

          {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-accent px-6 py-2.5 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "…" : t("pft.mSave")}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
            >
              {t("pft.mDiscard")}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">{t("pft.mSaveHint")}</p>
        </section>
      )}
    </div>
  );
}
