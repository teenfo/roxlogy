"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { checkpointLabel, checkpointsFor, raceBase } from "@/lib/race-format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import {
  clockNow,
  entryState,
  fmtClock,
  groupByWave,
  type BoardData,
  type MyEntry,
  type RaceEntry,
} from "@/lib/pft-race";

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

export function PftRaceStaff({ initial }: { initial: BoardData }) {
  const { t } = useI18n();
  const router = useRouter();
  const race = initial.race;
  const KEY = `roxlogy.pft.staff.${race.code}`;
  // 구간 목록 — PFT 6, 하이록스 시뮬 16/24/32 (마이그레이션 114). 큐 상한도 구간 수다.
  const cps = checkpointsFor(race.format, race.checkpoints);
  const PENDING_LIMIT = cps.length;
  const isSim = race.format === "hyrox_sim";

  const [data, setData] = useState<BoardData>(initial);
  const [status, setStatus] = useState(race.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** 웨이브 출발 영역 펼침 — 스태프가 직접 누를 때만 바뀐다(자동으로 접지 않는다: 운영 피드백 2026-10-02) */
  const [waveOpen, setWaveOpen] = useState(true);
  /** 일시정지한 선수 → 멈춘 순간의 화면 시계(ms). **화면 표시만** 멈춘다 — 기록 시간은 서버 기준으로
   *  계속 흐르고, 재개하면 실제 경과로 돌아온다. 이 기기에만 해당(실수 탭 방지용, 2026-10-02) */
  const [paused, setPaused] = useState<Record<string, number>>({});
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

  /** 주어진 엔트리들을 서버 now() 한 값으로 같이 출발시킨다. */
  const startEntries = async (ids: string[]) => {
    if (!ids.length) return;
    const j = (await call("pft_race_staff_start", { p_race: raceId, p_entries: ids })) as
      | { ok?: boolean; started?: number; server_now?: string }
      | null;
    if (!j?.ok) return;
    if (j.server_now) offsetRef.current = Date.parse(j.server_now) - clockNow();
    setSelected([]);
    setNotice(t("pft.race.staffStarted", { n: j.started ?? 0 }));
    window.setTimeout(() => setNotice(null), 2500);
    await refetchNow();
  };

  const startWave = () => startEntries(selected);

  /** 중도포기 표시·해제. 서버가 출발 전·완주자·종료된 레이스를 막는다. */
  const setDnf = async (e: RaceEntry, on: boolean) => {
    if (on && !window.confirm(t("pft.race.dnfConfirm", { name: e.name }))) return;
    const j = (await call("pft_race_staff_dnf", {
      p_race: raceId,
      p_entry: e.entry_id,
      p_on: on,
    })) as { entry_id?: string; error?: string } | null;
    if (!j?.entry_id) return;
    await refetchNow();
  };

  /** 선택한 사람을 조에 넣는다(wave=null 이면 배정 해제). 이미 출발한 사람은 서버가 건너뛴다. */
  const assignWave = async (wave: number | null) => {
    if (!selected.length) return;
    const j = (await call("pft_race_set_wave", {
      p_race: raceId,
      p_entries: selected,
      p_wave: wave,
    })) as { ok?: boolean; updated?: number } | null;
    if (!j?.ok) return;
    setSelected([]);
    setNotice(
      wave == null
        ? t("pft.race.waveCleared", { n: j.updated ?? 0 })
        : t("pft.race.waveAssigned", { n: j.updated ?? 0, wave }),
    );
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

  /** 고른 대기자를 한꺼번에 제외 — 대기자는 아래 카드에 없으므로 웨이브 목록에서 뺀다 */
  const removeSelected = async () => {
    const rows = data.entries.filter((e) => entryState(e) === "waiting" && selected.includes(e.entry_id));
    if (!rows.length) return;
    if (
      !window.confirm(
        t("pft.race.staffRemoveSelectedConfirm", { n: rows.length, names: rows.map((e) => e.name).join(", ") }),
      )
    )
      return;
    for (const e of rows) {
      const j = (await call("pft_race_staff_remove", { p_race: raceId, p_entry: e.entry_id })) as { ok?: boolean } | null;
      // 하나라도 실패하면 거기서 멈춘다 — 오류는 call 이 띄운다
      if (!j?.ok) break;
      setSelected((s) => s.filter((id) => id !== e.entry_id));
      setData((d) => ({ ...d, entries: d.entries.filter((x) => x.entry_id !== e.entry_id) }));
    }
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
  // 아직 출발하지 않은 사람만 조로 묶는다 — 출발한 사람은 조를 바꿀 수 없다(서버도 막는다)
  const waveGroups = groupByWave(waiting);
  // 선택이 어느 조와 정확히 일치하는지 — 그 조 버튼을 눌린 상태로 보여 준다
  const picked =
    selected.length > 0
      ? (waveGroups.find(
          (g) =>
            g.wave != null &&
            g.rows.length === selected.length &&
            g.rows.every((e) => selected.includes(e.entry_id)),
        )?.wave ?? null)
      : null;
  const stationLabel = (i: number) => (cps[i] ? checkpointLabel(t, cps[i]) : "");
  const waveShown = waveOpen;
  // 조가 정해진 대기자는 칩 목록에서 빠지고 아래 그리드의 웨이브 카드로 간다
  const unassigned = waiting.filter((e) => e.wave == null);
  // 조 컨테이너 — 조가 정해진 선수는 대기·진행·완주 모두 자기 조 안에 기록 카드로 남는다(2026-10-02 시안).
  // 종료된 레이스는 조 없이 전원 한 그리드.
  const waveSections = closed
    ? []
    : [...new Set(entries.filter((e) => e.wave != null).map((e) => e.wave as number))]
        .sort((x, y) => x - y)
        .map((w) => ({
          wave: w,
          rows: entries.filter((e) => e.wave === w),
          waitingRows: entries.filter((e) => e.wave === w && entryState(e) === "waiting"),
        }));
  // 종료된 레이스는 웨이브 영역이 없으므로 모두 보여 준다(미출발은 미완주로 표시).
  // 조 없는 선수 중 출발한 사람 — 조 컨테이너 아래 일반 그리드. 출발 전 미배정은 위 칩 목록에 있다
  const looseEntries = closed ? entries : entries.filter((e) => e.wave == null && entryState(e) !== "waiting");
  const cardCount = waveSections.reduce((n, g) => n + g.rows.length, 0) + looseEntries.length;

  /** 선수 기록 카드 한 장 — 조 컨테이너 안과 조 없는 그리드가 같이 쓴다 */
  /** compact = 조 컨테이너 안(시안: 한 줄 4장) — 글자·버튼을 줄인다 */
  const renderCard = (e: RaceEntry, compact = false) => {
              const state = entryState(e);
              const mine = isClient ? (pending[e.entry_id] ?? []) : [];
              const splits = [...e.splits, ...mine];
              const current = splits.length;
              const done = state === "finished" || current >= cps.length;
              // 명시적 중도포기(101) 또는 종료된 레이스의 미완주 — 어느 쪽이든 경과가 흐르면 안 된다
              const quit = state === "dnf";
              const dnf = quit || (closed && state !== "finished");
              const elapsed = e.started_at && !closed && !quit ? Math.max(0, now - Date.parse(e.started_at)) : 0;
              const total = e.total_ms ?? (done ? splits[splits.length - 1] : null);
              const isPaused = paused[e.entry_id] != null && state === "running" && !done && !closed;
              const togglePause = () =>
                setPaused((p) => {
                  const next = { ...p };
                  if (isPaused) delete next[e.entry_id];
                  else next[e.entry_id] = elapsed;
                  return next;
                });
              return (
                <li
                  key={e.entry_id}
                  className={`rounded-2xl border p-4 ${
                    dnf
                      ? "border-line-soft bg-card opacity-80"
                      : state === "running"
                        ? "border-line-accent bg-highlight"
                        : state === "finished"
                          ? "border-line bg-card"
                          : "border-line-soft bg-card opacity-80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2">
                        <span className={`truncate font-extrabold ${compact ? "text-sm" : "text-lg"}`}>{e.name}</span>
                        {e.scaled && (
                          <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                            {t("pft.scaledTag")}
                          </span>
                        )}
                      </p>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted">
                        {dnf
                          ? t("pft.race.dnf")
                          : state === "finished"
                            ? t("pft.race.finished")
                            : state === "running"
                              ? t(isPaused ? "pft.race.pausedLabel" : "pft.race.running")
                              : t("pft.race.waiting")}
                        {mine.length > 0 && ` · ${t("pft.race.staffPending", { n: mine.length })}`}
                      </p>
                    </div>
                    <p className={`tabular font-black leading-none ${compact ? "text-xl" : "text-3xl"} ${isPaused ? "text-muted" : !dnf && state === "running" && !done ? "text-accent" : dnf ? "text-muted" : ""}`}>
                      {state === "finished"
                        ? formatMs(total)
                        : dnf
                          ? "—"
                          : state === "running"
                            ? fmtClock(isPaused ? paused[e.entry_id] : elapsed)
                            : "0:00.0"}
                    </p>
                  </div>

                  {/* 구간 진행 — PFT 는 6칸에 구간 시간까지, 시뮬(16~32칸)은 가는 막대 + 직전 구간 */}
                  {cps.length <= 6 ? (
                    <div className="mt-3 grid grid-cols-6 gap-1" aria-label={t("pft.race.progressLabel", { done: splits.length })}>
                      {cps.map((cp, i) => {
                        const fin = i < splits.length;
                        const cur = state === "running" && !done && i === current;
                        const ms = fin ? splits[i] - (i === 0 ? 0 : splits[i - 1]) : null;
                        return (
                          <span key={cp.key} className="flex flex-col items-center gap-1">
                            <span
                              className={`h-2 w-full rounded-full ${cur ? "motion-safe:animate-pulse" : ""}`}
                              style={{ background: fin || cur ? cp.color : "var(--line)" }}
                            />
                            <span className="tabular text-[10px] text-muted">{ms != null ? formatMs(ms) : ""}</span>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-3" aria-label={t("race.progress", { done: Math.min(splits.length, cps.length), total: cps.length })}>
                      <div className="flex gap-[2px]">
                        {cps.map((cp, i) => {
                          const fin = i < splits.length;
                          const cur = state === "running" && !done && i === current;
                          return (
                            <span
                              key={cp.key}
                              className={`h-2 flex-1 rounded-sm ${cur ? "motion-safe:animate-pulse" : ""}`}
                              style={{ background: fin || cur ? cp.color : "var(--line)" }}
                            />
                          );
                        })}
                      </div>
                      <p className="tabular mt-1 flex justify-between text-[11px] text-muted">
                        <span>
                          {Math.min(splits.length, cps.length)}/{cps.length}
                        </span>
                        {splits.length > 0 && (
                          <span>
                            {stationLabel(Math.min(splits.length, cps.length) - 1)} ·{" "}
                            {formatMs(splits[splits.length - 1] - (splits.length > 1 ? splits[splits.length - 2] : 0))}
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {isPaused && (
                    <p className="mt-3 rounded-2xl border border-line-strong bg-inset px-3 py-4 text-center text-sm font-semibold text-muted" role="status">
                      {t("pft.race.pausedNote")}
                    </p>
                  )}
                  {state === "running" && !done && !closed && !isPaused && (
                    <button
                      type="button"
                      onClick={() => tap(e)}
                      disabled={closed}
                      // 버튼 색 = 지금 찍을 종목의 색. 6칸 바의 현재 칸과 같은 색이라
                      // 어느 종목을 찍는 중인지 색만으로 알아본다.
                      style={{ background: cps[current]?.color }}
                      className={`mt-3 flex w-full flex-col items-center justify-center text-[#141414] hover:brightness-110 active:brightness-95 disabled:opacity-40 ${compact ? "h-12 rounded-xl" : "h-16 rounded-2xl"}`}
                    >
                      <span className="text-[11px] font-bold opacity-80">
                        {isSim ? t("race.tapHint", { n: current + 1, total: cps.length }) : t("pft.race.tapHint", { n: current + 1 })}
                      </span>
                      <span className={`font-black ${compact ? "text-sm" : "text-xl"}`}>{t("pft.race.staffTap", { station: stationLabel(current) })} ✓</span>
                    </button>
                  )}
                  {state === "running" && done && (
                    <p className="mt-3 rounded-xl bg-inset px-3 py-2 text-center text-sm text-muted" role="status">
                      {t("pft.race.staffPending", { n: mine.length })}
                    </p>
                  )}

                  {closed ? (
                    <p className="mt-3 rounded-xl bg-inset px-3 py-2 text-center text-xs text-muted">
                      {t("pft.race.closedLocked")}
                    </p>
                  ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {/* 일시정지 — 진행 중인 선수만. 화면 시계·버튼만 멈춘다(기록 시간은 계속) */}
                    {state === "running" && !done && (
                      <button
                        type="button"
                        onClick={togglePause}
                        aria-pressed={isPaused}
                        className={`flex items-center rounded-lg font-bold ${compact ? "h-8 px-2 text-[11px]" : "h-9 px-3 text-xs"} ${
                          isPaused
                            ? "bg-accent text-background hover:brightness-110"
                            : "border border-line-strong bg-control hover:border-muted/60"
                        }`}
                      >
                        {isPaused ? (
                          `▶ ${t("pft.race.resume")}`
                        ) : (
                          <span className="flex items-center gap-1.5">
                            {/* 일시정지 기호 — ⏸ 글자는 일부 글꼴에서 네모로 깨져서 막대 두 개로 그린다 */}
                            <span aria-hidden className="flex gap-[3px]">
                              <span className="h-3 w-[3px] rounded-sm bg-current" />
                              <span className="h-3 w-[3px] rounded-sm bg-current" />
                            </span>
                            {t("pft.race.pause")}
                          </span>
                        )}
                      </button>
                    )}
                    {(state === "running" || state === "finished") && (
                      <button
                        type="button"
                        onClick={() => undo(e)}
                        disabled={busy || closed || isPaused || (!splits.length && state !== "finished")}
                        className={`${compact ? "h-8 px-2 text-[11px]" : "h-9 px-3 text-xs"} rounded-lg border border-line-strong bg-control font-semibold hover:border-muted/60 disabled:opacity-40`}
                      >
                        ↶ {t(state === "finished" ? "pft.race.undoFinish" : "pft.mUndo")}
                      </button>
                    )}
                    {(state === "running" || quit) && (
                      <button
                        type="button"
                        onClick={() => reset(e)}
                        disabled={busy || closed || isPaused || mine.length > 0}
                        className={`${compact ? "h-8 px-2 text-[11px]" : "h-9 px-3 text-xs"} rounded-lg border border-line-strong bg-control font-semibold hover:border-danger-line-strong hover:text-danger disabled:opacity-40`}
                      >
                        {t("pft.mReset")}
                      </button>
                    )}
                    {/* 중도포기 — 출발한 사람만. 누르면 시계가 멈추고 보드에서도 빠진다 */}
                    {(state === "running" || quit) && (
                      <button
                        type="button"
                        onClick={() => setDnf(e, !quit)}
                        disabled={busy || closed || isPaused}
                        className={`${compact ? "h-8 px-2 text-[11px]" : "h-9 px-3 text-xs"} rounded-lg border font-semibold disabled:opacity-40 ${
                          quit
                            ? "border-line-strong bg-control hover:border-muted/60"
                            : "border-danger-line-strong bg-control text-danger hover:brightness-125"
                        }`}
                      >
                        {quit ? t("pft.race.dnfUndo") : t("pft.race.dnfMark")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(e)}
                      disabled={busy || closed || isPaused}
                      className={`ml-auto ${compact ? "h-8 px-2 text-[11px]" : "h-9 px-3 text-xs"} rounded-lg border border-line-soft font-semibold text-muted hover:border-danger-line-strong hover:text-danger disabled:opacity-40`}
                    >
                      {t("pft.race.staffRemove")}
                    </button>
                  </div>
                  )}
                </li>
              );
  };

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
            href={`${raceBase(race.format)}/${race.code}`}
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

      {!closed && (
      <div className="flex flex-col gap-4">
        {/* 참가자 추가 — 맨 위 한 줄. 넓은 화면에서는 제목과 검색칸을 한 줄에 둔다(빈 여백 없이) */}
        <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
            <div className="min-w-0 md:flex-1">
              <p className="text-sm font-bold">{t("pft.race.staffAdd")}</p>
              <p className="mt-1 text-xs text-muted">{t("pft.race.staffAddDesc")}</p>
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("pft.race.staffSearchPh")}
              aria-label={t("pft.race.staffSearchPh")}
              disabled={closed}
              className="h-11 w-full rounded-lg border border-line-strong bg-control px-3 text-sm disabled:opacity-40 md:w-[340px] md:shrink-0"
            />
          </div>
          {results && (
            <ul className="mt-3 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
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

        {/* 웨이브 출발 — 두 단. 왼쪽 = 고른 조·선택된 사람·출발, 오른쪽 = 대기자 고르기·조 배정 */}
        <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          {/* 머리 줄 = 요약 + 접기/펼치기. 접어 두면 이 한 줄만 남는다 */}
          <button
            type="button"
            onClick={() => setWaveOpen((o) => !o)}
            aria-expanded={waveShown}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">{t("pft.race.staffWave")}</span>
              <span className="mt-0.5 block text-xs text-muted">
                {t("pft.race.waveSummary", { waiting: waiting.length, selected: selected.length })}
              </span>
            </span>
            <span className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold">
              {t(waveShown ? "pft.race.waveCollapse" : "pft.race.waveExpand")}
              <span aria-hidden>{waveShown ? "▲" : "▼"}</span>
            </span>
          </button>
          {waveShown && waiting.length === 0 && (
            <p className="mt-3 rounded-xl bg-inset px-3 py-4 text-center text-sm text-muted">
              {t("pft.race.staffNoWaiting")}
            </p>
          )}
          {waveShown && waiting.length > 0 && (
            <>
            <p className="mt-2 text-xs text-muted">{t("pft.race.staffWaveDesc")}</p>
            <div className="mt-3 grid items-start gap-4 md:grid-cols-2">
              {/* 왼쪽 단 — 선택된 웨이브 */}
              <div className="flex flex-col gap-3">
                {/* 지금 선택된 사람 — 출발 전에 눈으로 한 번 더 확인 */}
                <div className="rounded-xl border border-line-soft bg-inset p-3">
                  <p className="text-xs font-bold text-muted">
                    {t("pft.race.staffSelectedN", { n: selected.length })}
                  </p>
                  {selected.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {waiting
                        .filter((e) => selected.includes(e.entry_id))
                        .map((e) => (
                          <li
                            key={e.entry_id}
                            className="rounded-full bg-highlight px-2.5 py-1 text-xs font-bold text-accent"
                          >
                            {e.name}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-muted">{t("pft.race.staffSelectedNone")}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={startWave}
                  disabled={busy || closed || !selected.length}
                  className="h-16 w-full rounded-2xl bg-accent text-xl font-black text-background hover:brightness-110 disabled:opacity-40"
                >
                  {t("pft.race.staffStart", { n: selected.length })}
                </button>
              </div>

              {/* 오른쪽 단 — 대기자 고르기 · 조 배정 */}
              <div className="flex flex-col">
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelected(unassigned.map((e) => e.entry_id))}
                    disabled={!unassigned.length}
                    className="h-8 rounded-lg border border-line-strong bg-control px-3 font-semibold disabled:opacity-40"
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
                  <button
                    type="button"
                    onClick={() => void removeSelected()}
                    disabled={busy || !selected.length}
                    className="ml-auto h-8 rounded-lg border border-line-soft px-3 font-semibold text-muted hover:border-danger-line-strong hover:text-danger disabled:opacity-40"
                  >
                    {t("pft.race.staffRemoveSelected")}
                  </button>
                </div>
                {/* 조 미배정 대기자 — 이름 칩 격자. 누르면 선택/해제. 높이 상한을 넘으면 이 안에서만 스크롤.
                    조를 정하면 칩은 사라지고 아래 그리드에 웨이브 카드로 놓인다 */}
                {unassigned.length === 0 && (
                  <p className="mt-2 rounded-lg bg-inset px-3 py-3 text-center text-xs text-muted">
                    {t("pft.race.allAssigned")}
                  </p>
                )}
                <ul className="mt-2 grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3">
                  {unassigned.map((e) => {
                    const on = selected.includes(e.entry_id);
                    return (
                      <li key={e.entry_id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setSelected((s) => (on ? s.filter((id) => id !== e.entry_id) : [...s, e.entry_id]))
                          }
                          className={`flex h-10 w-full items-center gap-1.5 rounded-lg border px-2.5 text-left text-sm font-semibold ${
                            on ? "border-accent bg-highlight text-accent" : "border-line-soft bg-inset hover:border-muted/60"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{e.name}</span>
                          {e.scaled && (
                            <span className="shrink-0 rounded bg-line px-1 py-0.5 text-[10px] font-bold uppercase text-muted">
                              {t("pft.scaledTag")}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {/* 선택 → 조 배정. 조를 먼저 짜 두고 순서대로 내보내기 위한 것 */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs font-semibold text-muted">
                    {t("pft.race.waveAssignTo")}
                  </span>
                  {[1, 2, 3, 4, 5, 6].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => assignWave(w)}
                      disabled={busy || closed || !selected.length}
                      className="tabular h-9 w-9 rounded-lg border border-line-strong bg-control text-sm font-extrabold disabled:opacity-40"
                    >
                      {w}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => assignWave(null)}
                    disabled={busy || closed || !selected.length}
                    className="h-9 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold text-muted disabled:opacity-40"
                  >
                    {t("pft.race.waveNone")}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-muted [word-break:keep-all]">
                  {t("pft.race.waveHint")}
                </p>
              </div>
            </div>
            </>
          )}
        </section>
      </div>
      )}

      {/* 참가자 카드 */}
      <section>
        <p className="text-sm font-bold">
          {t("pft.race.staffAthletes", { n: cardCount })}
          {!closed && unassigned.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-muted">{t("pft.race.waitingInWave", { n: unassigned.length })}</span>
          )}
        </p>
        {!closed && <p className="mt-0.5 text-xs text-muted">{t("pft.race.staffHint")}</p>}
        {cardCount === 0 ? (
          <p className="mt-2 rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-muted">
            {t(entries.length === 0 ? "pft.race.noEntries" : "pft.race.noneStarted")}
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            {/* 조 컨테이너 — 머리(조 번호·대기 인원·웨이브 선택) + 그 조 선수의 기록 카드 */}
            {waveSections.map((g) => {
              const on = picked === g.wave;
              return (
                <section
                  key={`wave-${g.wave}`}
                  aria-label={t("pft.race.waveN", { n: g.wave })}
                  className={`rounded-3xl border-2 p-4 sm:p-6 ${on ? "border-accent bg-highlight" : "border-line-accent bg-card"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-3xl font-black leading-none text-accent sm:text-4xl">
                        {t("pft.race.waveN", { n: g.wave })}
                      </p>
                      <p className="mt-2 text-sm text-muted">{t("pft.race.waveCardCount", { n: g.waitingRows.length })}</p>
                    </div>
                    <button
                      type="button"
                      // 누르면 **선택만** 한다 — 출발은 위 큰 버튼으로. 한 번 더 확인하고
                      // 내보내야 오출발이 나지 않는다(2026-09-13 운영 피드백).
                      onClick={() => setSelected(g.waitingRows.map((e) => e.entry_id))}
                      disabled={busy || g.waitingRows.length === 0}
                      aria-pressed={on}
                      className={`h-14 shrink-0 rounded-2xl border-2 px-6 text-lg font-black disabled:opacity-40 ${
                        on
                          ? "border-accent bg-accent text-background"
                          : "border-line-accent bg-highlight text-accent hover:brightness-125"
                      }`}
                    >
                      {g.waitingRows.length === 0
                        ? t("pft.race.waveAllStarted")
                        : t(on ? "pft.race.waveSelected" : "pft.race.waveSelect")}
                    </button>
                  </div>
                  <ul className="mt-4 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">{g.rows.map((e) => renderCard(e, true))}</ul>
                </section>
              );
            })}
            {looseEntries.length > 0 && (
              <ul className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                {looseEntries.map((e) => renderCard(e))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
