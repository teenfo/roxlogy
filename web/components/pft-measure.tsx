"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { PFT_STATIONS } from "@/lib/pft";
import { PFT_MIN_TOTAL_MS, PftMeasureView, type PftBest } from "@/components/pft-measure-view";

/** 진행 중인 측정을 브라우저에 남긴다 — 25분짜리라 실수로 새로고침하거나
 *  전화가 와서 앱이 내려가면 기록이 통째로 날아간다. */
const KEY = "roxlogy.pft.measure.v1";

type Saved = { startedAt: number; splits: number[] };

/** 일반 PFT 측정 — 상태는 이 폰(localStorage)에만 두고 완주 뒤 저장 버튼으로 pft_results 에 넣는다.
 *  화면은 레이스 측정과 같은 PftMeasureView. */
export function PftMeasure({
  defaultAge,
  defaultGender,
  best = null,
}: {
  defaultAge: number | null;
  defaultGender: string | null;
  /** 내 최고 기록 — 예상 완주 비율과 구간별 PB 비교용 (없으면 균등 배분) */
  best?: PftBest | null;
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
  const totalMs = done ? splits[splits.length - 1] : startedAt == null ? 0 : now - startedAt;

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
      else window.localStorage.setItem(KEY, JSON.stringify({ startedAt, splits } satisfies Saved));
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
        if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
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
    setSplits((p) => (p.length >= PFT_STATIONS.length ? p : [...p, Date.now() - startedAt]));
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
    if (totalMs < PFT_MIN_TOTAL_MS) return setErr(t("pft.errTooShort"));
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

  const tooShort = done && totalMs < PFT_MIN_TOTAL_MS;

  return (
    <PftMeasureView
      title={t("pft.mTitle")}
      startedAt={startedAt}
      splits={splits}
      now={now}
      scaled={scaled}
      defaultAge={defaultAge}
      best={best}
      busy={busy}
      onStart={start}
      onComplete={complete}
      onUndo={undo}
      onReset={reset}
      finishExtra={
        <>
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
                <span className="block text-xs text-muted">{t("pft.fScaledHint")}</span>
              </span>
            </label>
          </div>

          {err && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {err}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || tooShort}
              className={`h-11 rounded-lg px-6 text-[15px] font-extrabold ${
                tooShort ? "cursor-not-allowed bg-[#2a2a2a] text-muted-2" : "bg-accent text-background hover:brightness-110"
              } disabled:opacity-60`}
            >
              {busy ? t("common.saving") : t("pft.mSave")}
            </button>
            <button type="button" onClick={reset} className="text-[13px] text-muted hover:text-danger">
              {t("pft.mDiscard")}
            </button>
            <p className={`ml-auto text-xs ${tooShort ? "text-danger" : "text-muted"}`}>
              {tooShort ? t("pft.errTooShort") : t("pft.mSaveHint")}
            </p>
          </div>
        </>
      }
    />
  );
}
