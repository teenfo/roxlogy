"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { PFT_STATIONS, badgeClass, badgeDictKey, pftBadge } from "@/lib/pft";
import { fmtClock, type MyEntry, type RaceInfo } from "@/lib/pft-race";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * 참가자 화면 — 시작·종목 완료를 찍으면 서버에 동기화된다. 파트너가 이 폰을 들고 눌러 준다.
 *
 * 시각: 시작을 누른 순간의 폰 시각을 기준으로 경과(ms)를 재서 스플릿으로 보낸다(서버 시각이
 * 아니라 폰이 잰 값 — 네트워크 지연·오프라인과 무관하게 정확). 보내지 못한 스플릿은
 * localStorage 큐에 쌓였다가 순서대로 재전송된다. 새로고침해도 큐와 시작 시각은 남는다.
 */
export function PftRaceRunner({
  race,
  initialEntry,
  serverNow,
  canManage,
  defaultAge,
}: {
  race: RaceInfo;
  initialEntry: MyEntry | null;
  serverNow: string;
  canManage: boolean;
  defaultAge: number | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const KEY = `roxlogy.pft.race.${race.code}`;

  const [entry, setEntry] = useState<MyEntry | null>(initialEntry);
  const [status, setStatus] = useState(race.status);
  const [scaled, setScaled] = useState(initialEntry?.scaled ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 폰 기준 시작 시각 + 아직 못 보낸 스플릿(경과 ms)
  const [local, setLocal] = useState<{ startedLocal: number | null; pending: number[] }>(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as { startedLocal: number | null; pending: number[] };
    } catch {
      /* noop */
    }
    // 다른 기기에서 시작했거나 저장이 없으면 서버 시작 시각에서 역산 (서버 오프셋 보정)
    if (initialEntry?.started_at) {
      const offset = Date.parse(serverNow) - Date.now();
      return { startedLocal: Date.parse(initialEntry.started_at) - offset, pending: [] };
    }
    return { startedLocal: null, pending: [] };
  });
  const [now, setNow] = useState(() => Date.now());
  const lastTapRef = useRef(0);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const flushingRef = useRef(false);

  const joined = !!entry;
  const finished = !!entry?.finished_at;
  const serverSplits = entry?.splits ?? [];
  // 화면상의 스플릿 = 서버에 있는 것 + 아직 못 보낸 것
  const splits = [...serverSplits, ...local.pending];
  const running = joined && local.startedLocal != null && !finished && !!entry?.started_at;
  const current = splits.length;
  const done = splits.length >= PFT_STATIONS.length;
  const elapsed = local.startedLocal != null ? now - local.startedLocal : 0;
  const closed = status === "closed";

  const persist = (v: { startedLocal: number | null; pending: number[] }) => {
    setLocal(v);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      /* noop */
    }
  };

  // 러닝 클록
  useEffect(() => {
    if (!running || done) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running, done]);

  // 측정 중 화면 유지
  useEffect(() => {
    if (!running || done) return;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) void s.release();
        else wakeRef.current = s;
      } catch {
        /* noop */
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
  }, [running, done]);

  // 큐 전송 — 순서대로 하나씩. 실패하면 3초 뒤 다시.
  useEffect(() => {
    if (!local.pending.length || !entry) return;
    let cancelled = false;
    const flush = async () => {
      if (flushingRef.current) return;
      flushingRef.current = true;
      const supabase = createClient();
      const ms = local.pending[0];
      const { data, error } = await supabase.rpc("pft_race_split", {
        p_race: race.id,
        p_elapsed_ms: Math.round(ms),
      });
      flushingRef.current = false;
      if (cancelled) return;
      if (error) {
        setErr(t("pft.race.syncRetry"));
        return; // 네트워크 — 다음 타이머에 재시도
      }
      const j = data as MyEntry & { error?: string };
      if (j.error) {
        // 서버가 거부한 스플릿(이미 완주·역순 등)은 버리고 서버 상태로 맞춘다
        setErr(t(`pft.race.err.${j.error}` as DictKey));
        const { data: mine } = await supabase.rpc("pft_race_my_entry", { p_race: race.id });
        if (mine) setEntry(mine as MyEntry);
        persist({ ...local, pending: local.pending.slice(1) });
        return;
      }
      setErr(null);
      setEntry(j);
      persist({ ...local, pending: local.pending.slice(1) });
    };
    void flush();
    const id = window.setInterval(() => void flush(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.pending.length, entry?.entry_id, race.id]);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return null;
    }
    const j = data as { error?: string } | null;
    if (j?.error) {
      setErr(t(`pft.race.err.${j.error}` as DictKey));
      return null;
    }
    return data;
  }

  const join = async () => {
    const j = (await call("pft_race_join", { p_code: race.code })) as { ok?: boolean } | null;
    if (!j?.ok) return;
    const supabase = createClient();
    const { data: mine } = await supabase.rpc("pft_race_my_entry", { p_race: race.id });
    setEntry(mine as MyEntry);
  };

  const start = async () => {
    const at = Date.now();
    const j = (await call("pft_race_start", { p_race: race.id, p_scaled: scaled })) as MyEntry | null;
    if (!j) return;
    setEntry(j);
    persist({ startedLocal: at, pending: [] });
    setNow(at);
  };

  const tap = () => {
    if (!running || done) return;
    const at = Date.now();
    if (at - lastTapRef.current < 1200) return; // 겹쳐 누름 방지
    lastTapRef.current = at;
    const ms = at - (local.startedLocal ?? at);
    const last = splits[splits.length - 1] ?? 0;
    if (ms <= last) return;
    persist({ ...local, pending: [...local.pending, ms] });
    if (navigator.vibrate) navigator.vibrate(40);
  };

  const undo = async () => {
    if (local.pending.length) {
      persist({ ...local, pending: local.pending.slice(0, -1) });
      return;
    }
    const j = (await call("pft_race_undo", { p_race: race.id })) as MyEntry | null;
    if (j) setEntry(j);
  };

  const reset = async () => {
    if (!window.confirm(t("pft.resetConfirm"))) return;
    const j = (await call("pft_race_reset", { p_race: race.id })) as MyEntry | null;
    if (!j) return;
    setEntry(j);
    persist({ startedLocal: null, pending: [] });
  };

  const setRaceStatus = async (next: "open" | "closed") => {
    if (next === "closed" && !window.confirm(t("pft.race.closeConfirm"))) return;
    const j = (await call("pft_race_set_status", { p_race: race.id, p_status: next })) as
      | { ok?: boolean }
      | null;
    if (!j?.ok) return;
    setStatus(next);
    setNotice(t(next === "closed" ? "pft.race.closedDone" : "pft.race.reopenedDone"));
    router.refresh();
  };

  const boardUrl = `${typeof window === "undefined" ? "" : window.location.origin}/board/${race.code}`;
  const copyBoard = async () => {
    try {
      await navigator.clipboard.writeText(t("pft.race.shareText", { title: race.title, code: race.code, url: boardUrl }));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr(t("pft.race.copyFail"));
    }
  };

  const total = done ? splits[splits.length - 1] : null;
  const badge = total != null ? pftBadge(total, defaultAge, scaled) : null;
  const stationLabel = (i: number) => t(PFT_STATIONS[i].label as DictKey);

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-accent">
            {t("pft.race.title")}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{race.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("pft.race.code")} <span className="font-mono font-bold tracking-[0.2em] text-foreground">{race.code}</span>
            {" · "}
            <span className={closed ? "text-muted" : "text-success"}>
              {t(closed ? "pft.race.closed" : "pft.race.open")}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/board/${race.code}`}
            target="_blank"
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-muted/60"
          >
            {t("pft.race.openBoard")}
          </Link>
          <button
            type="button"
            onClick={copyBoard}
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-muted/60"
          >
            {copied ? t("common.copied") : t("pft.race.share")}
          </button>
        </div>
      </div>

      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}

      {/* 참가 전 */}
      {!joined && (
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="text-sm text-muted">{t("pft.race.joinDesc")}</p>
          <button
            type="button"
            onClick={join}
            disabled={busy || closed}
            className="mt-4 h-14 w-full rounded-xl bg-accent text-lg font-black text-background hover:brightness-110 disabled:opacity-40"
          >
            {t("pft.race.join")}
          </button>
          {closed && <p className="mt-2 text-xs text-muted">{t("pft.race.closedNote")}</p>}
        </div>
      )}

      {/* 참가 후 — 측정 */}
      {joined && (
        <div className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted">
                {done ? t("pft.race.finished") : running ? t("pft.race.running") : t("pft.race.ready")}
              </p>
              <p className={`tabular mt-1 text-5xl font-black leading-none ${running && !done ? "text-accent" : ""}`}>
                {done ? formatMs(total) : running ? fmtClock(elapsed) : "0:00.0"}
              </p>
              {local.pending.length > 0 && (
                <p role="status" className="mt-1 text-xs text-muted">
                  {t("pft.race.syncPending", { n: local.pending.length })}
                </p>
              )}
            </div>
            {!running && !done && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={scaled}
                  onChange={(e) => setScaled(e.target.checked)}
                  className="accent-accent"
                />
                {t("pft.scaledTag")}
              </label>
            )}
            {running && !done && (
              <span className="flex items-center gap-2">
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
                  disabled={busy || local.pending.length > 0}
                  className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-danger-line-strong hover:text-danger disabled:opacity-40"
                >
                  {t("pft.mReset")}
                </button>
              </span>
            )}
          </div>

          {/* 진행 바 */}
          <div className="mt-3 grid grid-cols-6 gap-1" aria-hidden>
            {PFT_STATIONS.map((st, i) => (
              <span
                key={st.key}
                className={`h-1.5 rounded-full ${
                  i < splits.length ? "bg-success" : running && i === current ? "bg-accent" : "bg-line"
                }`}
              />
            ))}
          </div>

          {/* 큰 버튼 — 파트너가 누른다 */}
          {!running && !done && (
            <button
              type="button"
              onClick={start}
              disabled={busy || closed}
              className="mt-4 h-20 w-full rounded-2xl bg-accent text-2xl font-black text-background hover:brightness-110 disabled:opacity-40"
            >
              ▶ {t("pft.mStart")}
            </button>
          )}
          {running && !done && (
            <button
              type="button"
              onClick={tap}
              disabled={closed}
              className="mt-4 flex h-28 w-full flex-col items-center justify-center rounded-2xl bg-accent text-background hover:brightness-110 active:brightness-95 disabled:opacity-40"
            >
              <span className="text-sm font-bold opacity-80">
                {t("pft.race.tapHint", { n: current + 1 })}
              </span>
              <span className="text-3xl font-black">{stationLabel(current)} ✓</span>
            </button>
          )}
          {done && (
            <div className="mt-4 rounded-xl border border-line-accent bg-highlight p-4">
              <p className="text-sm">
                {t("pft.race.doneMsg", { total: formatMs(total) })}{" "}
                {badge && (
                  <span className={`ml-1 rounded-md px-2 py-0.5 text-xs font-bold ${badgeClass(badge)}`}>
                    {t(badgeDictKey(badge))}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted">
                {entry?.result_id ? t("pft.race.savedNote") : t("pft.race.notSavedNote")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/pft" className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-bold text-background">
                  {t("pft.title")}
                </Link>
                {!closed && (
                  <button
                    type="button"
                    onClick={undo}
                    disabled={busy}
                    className="flex h-9 items-center rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold"
                  >
                    ↶ {t("pft.race.undoFinish")}
                  </button>
                )}
              </div>
            </div>
          )}
          {!done && <p className="mt-3 text-xs text-muted">{t("pft.race.partnerHint")}</p>}
          {closed && !done && <p className="mt-2 text-xs text-danger">{t("pft.race.closedNote")}</p>}

          {/* 종목 목록 */}
          <ol className="mt-4 flex flex-col gap-1.5">
            {PFT_STATIONS.map((st, i) => {
              const fin = i < splits.length;
              const cur = running && !done && i === current;
              const ms = fin ? splits[i] - (i === 0 ? 0 : splits[i - 1]) : null;
              return (
                <li
                  key={st.key}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                    cur ? "border-accent bg-highlight" : fin ? "border-line bg-inset" : "border-line-soft opacity-50"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold ${
                      cur ? "bg-accent text-background" : fin ? "bg-success-bg text-success" : "bg-line text-muted"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{t(st.label as DictKey)}</span>
                  <span className="tabular text-sm font-bold">{ms != null ? formatMs(ms) : ""}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* 운영 */}
      {canManage && (
        <div className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <p className="text-sm font-bold">{t("pft.race.manage")}</p>
          <p className="mt-1 text-xs text-muted">{t("pft.race.manageDesc")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {closed ? (
              <button
                type="button"
                onClick={() => setRaceStatus("open")}
                disabled={busy}
                className="flex h-9 items-center rounded-lg border border-line-strong bg-control px-3 text-sm font-semibold"
              >
                {t("pft.race.reopen")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRaceStatus("closed")}
                disabled={busy}
                className="flex h-9 items-center rounded-lg border border-danger-line-strong px-3 text-sm font-semibold text-danger hover:bg-danger-card"
              >
                {t("pft.race.close")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
