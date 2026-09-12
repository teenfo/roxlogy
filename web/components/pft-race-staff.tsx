"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { PFT_COLORS, PFT_STATIONS } from "@/lib/pft";
import { clockNow, entryState, fmtClock, type BoardData, type MyEntry, type RaceEntry } from "@/lib/pft-race";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * 스태프 타이밍 — 운영진이 한 기기(태블릿·폰)로 여러 참가자를 찍는다.
 *
 * · 참가자 등록: 이름 검색(pft_race_search_members) → pft_race_staff_add.
 * · 웨이브 출발: 대기 중 참가자를 골라 pft_race_staff_start — 서버 now() 한 값으로 같이 출발.
 *   응답의 server_now 로 이 기기의 시계 오프셋을 맞춘다.
 * · 종목 완료: 참가자 카드의 큰 버튼. 경과 = (기기 시각 + 서버 오프셋) − started_at.
 *   보내지 못한 탭은 참가자별 localStorage 큐에 쌓였다가 순서대로 재전송된다.
 * · 갱신: 보드와 같은 방식(Realtime 신호 + 5초 폴링) — 참가자 폰에서 찍은 것도 여기 보인다.
 */
type Pending = Record<string, number[]>;
type Search = { user_id: string; name: string; joined: boolean };

const PENDING_LIMIT = 6;

export function PftRaceStaff({ initial }: { initial: BoardData }) {
  const { t } = useI18n();
  const router = useRouter();
  const race = initial.race;
  const KEY = `roxlogy.pft.staff.${race.code}`;

  const [data, setData] = useState<BoardData>(initial);
  const [status, setStatus] = useState(race.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [fetched, setFetched] = useState<{ q: string; rows: Search[] } | null>(null);
  const [now, setNow] = useState(() => Date.parse(initial.server_now));
  // 참가자별 아직 못 보낸 스플릿(경과 ms). 서버 렌더에서는 비어 있고, 화면 반영은 마운트 뒤(isClient).
  const [pending, setPending] = useState<Pending>(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as Pending;
    } catch {
      /* noop */
    }
    return {};
  });
  const pendingRef = useRef<Pending>(pending);
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);
  const offsetRef = useRef(0);
  const flushingRef = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const lastTapRef = useRef<Record<string, number>>({});
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const closed = status === "closed";
  const raceId = race.id;

  const persist = (next: Pending) => {
    // 빈 큐는 지워서 저장소가 자라지 않게
    const clean: Pending = {};
    for (const [k, v] of Object.entries(next)) if (v.length) clean[k] = v;
    pendingRef.current = clean;
    setPending(clean);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(clean));
    } catch {
      /* noop */
    }
  };

  /** 서버가 돌려준 엔트리 한 개를 목록에 합친다 */
  const mergeEntry = (j: MyEntry) => {
    setData((d) => ({
      ...d,
      entries: d.entries.map((e) =>
        e.entry_id === j.entry_id
          ? { ...e, started_at: j.started_at, splits: j.splits, finished_at: j.finished_at, total_ms: j.total_ms, scaled: j.scaled }
          : e,
      ),
    }));
  };

  // 갱신: Realtime 신호 + 폴링, 250ms 시계
  useEffect(() => {
    offsetRef.current = Date.parse(initial.server_now) - Date.now();
    const supabase = createClient();
    let cancelled = false;
    const refetch = async () => {
      const { data: d, error } = await supabase.rpc("pft_race_board", { p_code: race.code });
      if (cancelled) return;
      if (error || !d) {
        setOffline(true);
        return;
      }
      const b = d as BoardData;
      offsetRef.current = Date.parse(b.server_now) - Date.now();
      setOffline(false);
      setData(b);
      setStatus(b.race.status);
    };
    const ch = supabase
      .channel(`pft-race-staff-${raceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pft_race_entries", filter: `race_id=eq.${raceId}` },
        () => void refetch(),
      )
      .subscribe();
    const poll = window.setInterval(() => void refetch(), 5000);
    const tick = window.setInterval(() => setNow(Date.now() + offsetRef.current), 250);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
      void supabase.removeChannel(ch);
    };
  }, [race.code, raceId, initial.server_now]);

  const anyRunning = data.entries.some((e) => entryState(e) === "running");

  // 측정 중 화면 유지
  useEffect(() => {
    if (!anyRunning) return;
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
  }, [anyRunning]);

  // 큐 전송 — 참가자별로 순서대로. 실패한 참가자는 건너뛰고 3초 뒤 다시.
  const pendingCount = Object.values(pending).reduce((n, v) => n + v.length, 0);
  useEffect(() => {
    let stopped = false;
    const flush = async () => {
      if (flushingRef.current || stopped) return;
      flushingRef.current = true;
      try {
        const supabase = createClient();
        for (const entryId of Object.keys(pendingRef.current)) {
          let guard = 0;
          while (!stopped && (pendingRef.current[entryId] ?? []).length && guard++ < PENDING_LIMIT) {
            const ms = pendingRef.current[entryId][0];
            const { data: d, error } = await supabase.rpc("pft_race_staff_split", {
              p_race: raceId,
              p_entry: entryId,
              p_elapsed_ms: Math.round(ms),
            });
            if (stopped) return;
            if (error) {
              setErr(t("pft.race.syncRetry"));
              break; // 네트워크 — 다음 타이머에 재시도
            }
            const j = d as MyEntry & { error?: string };
            if (j.error) {
              // 서버가 거부(완주·역순·종료)한 탭은 버리고 서버 상태로 맞춘다
              setErr(t(`pft.race.err.${j.error}` as DictKey));
              persist({ ...pendingRef.current, [entryId]: [] });
              break;
            }
            setErr(null);
            mergeEntry(j);
            persist({ ...pendingRef.current, [entryId]: (pendingRef.current[entryId] ?? []).slice(1) });
          }
        }
      } finally {
        flushingRef.current = false;
      }
    };
    flushRef.current = flush;
    void flush();
    const id = window.setInterval(() => void flush(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // 이름 검색 — 300ms 디바운스
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    let cancelled = false;
    const id = window.setTimeout(async () => {
      const supabase = createClient();
      const { data: d, error } = await supabase.rpc("pft_race_search_members", { p_race: raceId, p_q: term });
      if (cancelled) return;
      if (error) {
        setErr(error.message);
        return;
      }
      const j = d as Search[] | { error?: string };
      if (Array.isArray(j)) setFetched({ q: term, rows: j });
      else if (j.error) setErr(t(`pft.race.err.${j.error}` as DictKey));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, raceId]);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: d, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return null;
    }
    const j = d as { error?: string } | null;
    if (j?.error) {
      setErr(t(`pft.race.err.${j.error}` as DictKey));
      return null;
    }
    return d;
  }

  const refetchNow = async () => {
    const supabase = createClient();
    const { data: d } = await supabase.rpc("pft_race_board", { p_code: race.code });
    if (d) {
      const b = d as BoardData;
      offsetRef.current = Date.parse(b.server_now) - clockNow();
      setData(b);
    }
  };

  const add = async (userId: string) => {
    const j = (await call("pft_race_staff_add", { p_race: raceId, p_user_id: userId })) as MyEntry | null;
    if (!j) return;
    setFetched((f) => (f ? { ...f, rows: f.rows.map((x) => (x.user_id === userId ? { ...x, joined: true } : x)) } : f));
    await refetchNow();
  };

  const startWave = async () => {
    if (!selected.length) return;
    const j = (await call("pft_race_staff_start", { p_race: raceId, p_entries: selected })) as
      | { ok?: boolean; started?: number; server_now?: string }
      | null;
    if (!j?.ok) return;
    if (j.server_now) offsetRef.current = Date.parse(j.server_now) - clockNow();
    setSelected([]);
    setNotice(t("pft.race.staffStarted", { n: j.started ?? 0 }));
    window.setTimeout(() => setNotice(null), 2500);
    await refetchNow();
  };

  const tap = (e: RaceEntry) => {
    if (closed || !e.started_at || e.finished_at) return;
    const at = clockNow();
    if (at - (lastTapRef.current[e.entry_id] ?? 0) < 1200) return; // 겹쳐 누름 방지
    lastTapRef.current[e.entry_id] = at;
    const mine = pending[e.entry_id] ?? [];
    if (e.splits.length + mine.length >= PENDING_LIMIT) return;
    const ms = at + offsetRef.current - Date.parse(e.started_at);
    const last = mine[mine.length - 1] ?? e.splits[e.splits.length - 1] ?? 0;
    if (ms <= last) return;
    persist({ ...pendingRef.current, [e.entry_id]: [...mine, ms] });
    if (navigator.vibrate) navigator.vibrate(40);
    void flushRef.current();
  };

  const undo = async (e: RaceEntry) => {
    const mine = pending[e.entry_id] ?? [];
    if (mine.length) {
      persist({ ...pendingRef.current, [e.entry_id]: mine.slice(0, -1) });
      return;
    }
    const j = (await call("pft_race_staff_undo", { p_race: raceId, p_entry: e.entry_id })) as MyEntry | null;
    if (j) mergeEntry(j);
  };

  const reset = async (e: RaceEntry) => {
    if (!window.confirm(t("pft.race.staffResetConfirm", { name: e.name }))) return;
    persist({ ...pendingRef.current, [e.entry_id]: [] });
    const j = (await call("pft_race_staff_reset", { p_race: raceId, p_entry: e.entry_id })) as MyEntry | null;
    if (j) mergeEntry(j);
  };

  const remove = async (e: RaceEntry) => {
    if (!window.confirm(t("pft.race.staffRemoveConfirm", { name: e.name }))) return;
    persist({ ...pendingRef.current, [e.entry_id]: [] });
    const j = (await call("pft_race_staff_remove", { p_race: raceId, p_entry: e.entry_id })) as { ok?: boolean } | null;
    if (!j?.ok) return;
    setSelected((s) => s.filter((id) => id !== e.entry_id));
    setData((d) => ({ ...d, entries: d.entries.filter((x) => x.entry_id !== e.entry_id) }));
  };

  const setRaceStatus = async (next: "open" | "closed") => {
    if (next === "closed" && !window.confirm(t("pft.race.closeConfirm"))) return;
    const j = (await call("pft_race_set_status", { p_race: raceId, p_status: next })) as { ok?: boolean } | null;
    if (!j?.ok) return;
    setStatus(next);
    setNotice(t(next === "closed" ? "pft.race.closedDone" : "pft.race.reopenedDone"));
    router.refresh();
  };

  // 검색 결과 — 입력을 지우면 바로 사라진다(마지막 응답이 아직 남아 있어도)
  const results = q.trim() && fetched && fetched.q === q.trim() ? fetched.rows : null;

  // 카드 순서는 "참가 순서"로 고정한다(서버가 joined_at 순으로 준다).
  // 진행에 따라 다시 정렬하면 종목을 찍을 때마다 카드가 자리를 옮겨서,
  // 스태프가 누가 어디 있었는지를 놓친다. 상태는 색·라벨로만 나타낸다.
  const entries = data.entries;
  const waiting = entries.filter((e) => entryState(e) === "waiting");
  const stationLabel = (i: number) => t(PFT_STATIONS[i].label as DictKey);

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-accent">{t("pft.race.staff")}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{race.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {race.join_open ? (
              <>
                {t("pft.race.code")}{" "}
                <span className="font-mono font-bold tracking-[0.2em] text-foreground">{race.code}</span>
                {" · "}
              </>
            ) : (
              <>
                {t("pft.race.staffAddedOnly")}
                {" · "}
              </>
            )}
            <span className={closed ? "text-muted" : "text-success"}>{t(closed ? "pft.race.closed" : "pft.race.open")}</span>
            {offline && (
              <>
                {" · "}
                <span role="status" className="text-danger">
                  {t("pft.race.offline")}
                </span>
              </>
            )}
            {isClient && pendingCount > 0 && (
              <>
                {" · "}
                <span role="status">{t("pft.race.staffPending", { n: pendingCount })}</span>
              </>
            )}
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
          <Link
            href={`/pft/race/${race.code}`}
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-muted/60"
          >
            {t("pft.race.staffRunner")}
          </Link>
          {closed ? (
            <button
              type="button"
              onClick={() => setRaceStatus("open")}
              disabled={busy}
              className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold"
            >
              {t("pft.race.reopen")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRaceStatus("closed")}
              disabled={busy}
              className="flex h-10 items-center rounded-lg border border-danger-line-strong px-4 text-sm font-semibold text-danger hover:bg-danger-card"
            >
              {t("pft.race.close")}
            </button>
          )}
        </div>
      </div>

      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      {closed && <p className="text-xs text-danger">{t("pft.race.closedNote")}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {/* 참가자 추가 */}
        <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <p className="text-sm font-bold">{t("pft.race.staffAdd")}</p>
          <p className="mt-1 text-xs text-muted">{t("pft.race.staffAddDesc")}</p>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("pft.race.staffSearchPh")}
            aria-label={t("pft.race.staffSearchPh")}
            disabled={closed}
            className="mt-3 h-11 w-full rounded-lg border border-line-strong bg-control px-3 text-sm disabled:opacity-40"
          />
          {results && (
            <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {results.length === 0 && <li className="px-1 py-2 text-xs text-muted">{t("pft.race.staffNoResult")}</li>}
              {results.map((r) => (
                <li key={r.user_id} className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
                  {r.joined ? (
                    <span className="text-xs text-muted">{t("pft.race.staffJoined")}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => add(r.user_id)}
                      disabled={busy || closed}
                      className="h-8 rounded-lg bg-accent px-3 text-xs font-bold text-background disabled:opacity-40"
                    >
                      {t("pft.race.staffAddBtn")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 웨이브 출발 */}
        <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <p className="text-sm font-bold">{t("pft.race.staffWave")}</p>
          <p className="mt-1 text-xs text-muted">{t("pft.race.staffWaveDesc")}</p>
          {waiting.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t("pft.race.staffNoWaiting")}</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelected(waiting.map((e) => e.entry_id))}
                  className="h-8 rounded-lg border border-line-strong bg-control px-3 font-semibold"
                >
                  {t("pft.race.staffSelectAll")}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  disabled={!selected.length}
                  className="h-8 rounded-lg border border-line-strong bg-control px-3 font-semibold disabled:opacity-40"
                >
                  {t("pft.race.staffClear")}
                </button>
              </div>
              <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
                {waiting.map((e) => {
                  const on = selected.includes(e.entry_id);
                  return (
                    <li key={e.entry_id}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${
                          on ? "border-accent bg-highlight" : "border-line-soft bg-inset"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(ev) =>
                            setSelected((s) =>
                              ev.target.checked ? [...s, e.entry_id] : s.filter((id) => id !== e.entry_id),
                            )
                          }
                          className="h-5 w-5 accent-accent"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.name}</span>
                        {e.scaled && (
                          <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                            {t("pft.scaledTag")}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={startWave}
                disabled={busy || closed || !selected.length}
                className="mt-3 h-16 w-full rounded-2xl bg-accent text-xl font-black text-background hover:brightness-110 disabled:opacity-40"
              >
                {t("pft.race.staffStart", { n: selected.length })}
              </button>
            </>
          )}
        </section>
      </div>

      {/* 참가자 카드 */}
      <section>
        <p className="text-sm font-bold">{t("pft.race.staffAthletes", { n: entries.length })}</p>
        <p className="mt-0.5 text-xs text-muted">{t("pft.race.staffHint")}</p>
        {entries.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-muted">
            {t("pft.race.noEntries")}
          </p>
        ) : (
          <ul className="mt-2 grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((e) => {
              const state = entryState(e);
              const mine = isClient ? (pending[e.entry_id] ?? []) : [];
              const splits = [...e.splits, ...mine];
              const current = splits.length;
              const done = state === "finished" || current >= PFT_STATIONS.length;
              const elapsed = e.started_at ? Math.max(0, now - Date.parse(e.started_at)) : 0;
              const total = e.total_ms ?? (done ? splits[splits.length - 1] : null);
              return (
                <li
                  key={e.entry_id}
                  className={`rounded-2xl border p-4 ${
                    state === "running" ? "border-line-accent bg-highlight" : state === "finished" ? "border-line bg-card" : "border-line-soft bg-card opacity-80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-lg font-extrabold">{e.name}</span>
                        {e.scaled && (
                          <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                            {t("pft.scaledTag")}
                          </span>
                        )}
                      </p>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted">
                        {state === "finished" ? t("pft.race.finished") : state === "running" ? t("pft.race.running") : t("pft.race.waiting")}
                        {mine.length > 0 && ` · ${t("pft.race.staffPending", { n: mine.length })}`}
                      </p>
                    </div>
                    <p className={`tabular text-3xl font-black leading-none ${state === "running" && !done ? "text-accent" : ""}`}>
                      {state === "finished" ? formatMs(total) : state === "running" ? fmtClock(elapsed) : "0:00.0"}
                    </p>
                  </div>

                  {/* 6칸 진행 */}
                  <div className="mt-3 grid grid-cols-6 gap-1" aria-label={t("pft.race.progressLabel", { done: splits.length })}>
                    {PFT_STATIONS.map((st, i) => {
                      const fin = i < splits.length;
                      const cur = state === "running" && !done && i === current;
                      const ms = fin ? splits[i] - (i === 0 ? 0 : splits[i - 1]) : null;
                      return (
                        <span key={st.key} className="flex flex-col items-center gap-1">
                          <span
                            className={`h-2 w-full rounded-full ${cur ? "motion-safe:animate-pulse" : ""}`}
                            style={{ background: fin || cur ? PFT_COLORS[st.key] : "var(--line)" }}
                          />
                          <span className="tabular text-[10px] text-muted">{ms != null ? formatMs(ms) : ""}</span>
                        </span>
                      );
                    })}
                  </div>

                  {state === "running" && !done && (
                    <button
                      type="button"
                      onClick={() => tap(e)}
                      disabled={closed}
                      // 버튼 색 = 지금 찍을 종목의 색. 6칸 바의 현재 칸과 같은 색이라
                      // 어느 종목을 찍는 중인지 색만으로 알아본다.
                      style={{ background: PFT_COLORS[PFT_STATIONS[current].key] }}
                      className="mt-3 flex h-16 w-full flex-col items-center justify-center rounded-2xl text-[#141414] hover:brightness-110 active:brightness-95 disabled:opacity-40"
                    >
                      <span className="text-[11px] font-bold opacity-80">{t("pft.race.tapHint", { n: current + 1 })}</span>
                      <span className="text-xl font-black">{t("pft.race.staffTap", { station: stationLabel(current) })} ✓</span>
                    </button>
                  )}
                  {state === "running" && done && (
                    <p className="mt-3 rounded-xl bg-inset px-3 py-2 text-center text-sm text-muted" role="status">
                      {t("pft.race.staffPending", { n: mine.length })}
                    </p>
                  )}
                  {state === "waiting" && (
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted">
                      <input
                        type="checkbox"
                        checked={selected.includes(e.entry_id)}
                        onChange={(ev) =>
                          setSelected((s) => (ev.target.checked ? [...s, e.entry_id] : s.filter((id) => id !== e.entry_id)))
                        }
                        className="h-5 w-5 accent-accent"
                      />
                      {t("pft.race.staffWave")}
                    </label>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(state === "running" || state === "finished") && (
                      <button
                        type="button"
                        onClick={() => undo(e)}
                        disabled={busy || closed || (!splits.length && state !== "finished")}
                        className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-muted/60 disabled:opacity-40"
                      >
                        ↶ {t(state === "finished" ? "pft.race.undoFinish" : "pft.mUndo")}
                      </button>
                    )}
                    {state === "running" && (
                      <button
                        type="button"
                        onClick={() => reset(e)}
                        disabled={busy || closed || mine.length > 0}
                        className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-danger-line-strong hover:text-danger disabled:opacity-40"
                      >
                        {t("pft.mReset")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(e)}
                      disabled={busy || closed}
                      className="ml-auto h-9 rounded-lg border border-line-soft px-3 text-xs font-semibold text-muted hover:border-danger-line-strong hover:text-danger disabled:opacity-40"
                    >
                      {t("pft.race.staffRemove")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
