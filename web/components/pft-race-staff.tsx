"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Check,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Users,
  WifiOff,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { PFT_COLORS, PFT_STATIONS } from "@/lib/pft";
import {
  clockNow,
  entryState,
  fmtClock,
  groupByWave,
  type BoardData,
  type MyEntry,
  type RaceEntry,
} from "@/lib/pft-race";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PftSplitStrip } from "@/components/pft-splits";
import { RoxDialog } from "@/components/rox/dialog";
import { Back, Chip, Go, Hint, PageHead, Panel } from "@/components/rox/ui";

/**
 * 스태프 타이밍 — 시안 pft-race.tsx 의 PftStaff 그대로 (PORT_PLAN §3-d):
 * .rx-pft-staff[ Back · PageHead(라이브보드·선수 화면·레이스 종료) · .rx-pft-statusline ·
 * .rx-pft-local(연결 상태) · .rx-pft-staff-top[ Panel 선수 추가 | Panel 웨이브 출발 ] ·
 * .rx-subhead · .rx-pft-athletes(Panel.rx-pft-athlete …) · .rx-pft-footnote ].
 * 확인은 시안의 AlertDialog 대신 우리 RoxDialog(§1-a).
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
type Confirm =
  | { kind: "remove"; entry: RaceEntry }
  | { kind: "reset"; entry: RaceEntry }
  | { kind: "dnf"; entry: RaceEntry }
  | { kind: "close" };

const PENDING_LIMIT = 6;
const WAVES = [1, 2, 3, 4, 5, 6] as const;

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
  const [confirm, setConfirm] = useState<Confirm | null>(null);
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

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
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
    flash(t("pft.race.staffStarted", { n: j.started ?? 0 }));
    await refetchNow();
  };

  /** 중도포기 표시·해제. 서버가 출발 전·완주자·종료된 레이스를 막는다. */
  const setDnf = async (e: RaceEntry, on: boolean) => {
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
    flash(
      wave == null
        ? t("pft.race.waveCleared", { n: j.updated ?? 0 })
        : t("pft.race.waveAssigned", { n: j.updated ?? 0, wave }),
    );
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
    persist({ ...pendingRef.current, [e.entry_id]: [] });
    const j = (await call("pft_race_staff_reset", { p_race: raceId, p_entry: e.entry_id })) as MyEntry | null;
    if (j) mergeEntry(j);
  };

  const remove = async (e: RaceEntry) => {
    persist({ ...pendingRef.current, [e.entry_id]: [] });
    const j = (await call("pft_race_staff_remove", { p_race: raceId, p_entry: e.entry_id })) as { ok?: boolean } | null;
    if (!j?.ok) return;
    setSelected((s) => s.filter((id) => id !== e.entry_id));
    setData((d) => ({ ...d, entries: d.entries.filter((x) => x.entry_id !== e.entry_id) }));
  };

  const setRaceStatus = async (next: "open" | "closed") => {
    const j = (await call("pft_race_set_status", { p_race: raceId, p_status: next })) as { ok?: boolean } | null;
    if (!j?.ok) return;
    setStatus(next);
    flash(t(next === "closed" ? "pft.race.closedDone" : "pft.race.reopenedDone"));
    router.refresh();
  };

  /** 확인 다이얼로그의 "실행" — 종류별로 한 번만 확인하고 곧바로 서버에 보낸다 */
  const confirmAction = async () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === "remove") await remove(c.entry);
    else if (c.kind === "reset") await reset(c.entry);
    else if (c.kind === "dnf") await setDnf(c.entry, true);
    else await setRaceStatus("closed");
  };

  // 검색 결과 — 입력을 지우면 바로 사라진다(마지막 응답이 아직 남아 있어도)
  const results = q.trim() && fetched && fetched.q === q.trim() ? fetched.rows : null;

  // 카드 순서는 "참가 순서"로 고정한다(서버가 joined_at 순으로 준다).
  // 진행에 따라 다시 정렬하면 종목을 찍을 때마다 카드가 자리를 옮겨서,
  // 스태프가 누가 어디 있었는지를 놓친다. 상태는 색·라벨로만 나타낸다.
  const entries = data.entries;
  const waiting = entries.filter((e) => entryState(e) === "waiting");
  const timing = entries.filter((e) => entryState(e) === "running");
  const finished = entries.filter((e) => entryState(e) === "finished");
  const selectedWaiting = waiting.filter((e) => selected.includes(e.entry_id));
  // 아직 출발하지 않은 사람만 조로 묶는다 — 출발한 사람은 조를 바꿀 수 없다(서버도 막는다)
  const waveGroups = groupByWave(waiting);
  const select = (id: string, checked: boolean) =>
    setSelected((s) => (checked ? [...new Set([...s, id])] : s.filter((x) => x !== id)));
  const stationLabel = (i: number) => t(PFT_STATIONS[i].label as DictKey);

  const stateLabel = (e: RaceEntry) => {
    const st = entryState(e);
    const dnf = st === "dnf" || (closed && st !== "finished");
    return dnf
      ? t("pft.race.dnf")
      : st === "finished"
        ? t("pft.race.finished")
        : st === "running"
          ? t("pft.race.running")
          : t("pft.race.waiting");
  };

  return (
    <div className="rx-pft-staff">
      <Back href="/pft/race" label={t("pft.race.title")} />
      <PageHead
        title={race.title}
        description={t("pft.race.staffLine")}
        action={
          <div className="rx-actions">
            <Go href={`/board/${race.code}`}>
              <Monitor size={16} />
              {t("pft.race.openBoard")}
            </Go>
            <Go href={`/pft/race/${race.code}`}>{t("pft.race.staffRunner")}</Go>
            {closed ? (
              <Button variant="outline" disabled={busy} onClick={() => setRaceStatus("open")}>
                {t("pft.race.reopen")}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="rx-pft-close"
                disabled={busy || timing.length > 0}
                onClick={() => setConfirm({ kind: "close" })}
              >
                {t("pft.race.close")}
              </Button>
            )}
          </div>
        }
      />
      <div className="rx-pft-statusline">
        <Chip tone={closed ? "neutral" : "green"}>{t(closed ? "pft.race.closed" : "pft.race.open")}</Chip>
        <span>
          {race.crew ? `${race.crew} · ` : ""}
          {race.join_open ? race.code : t("pft.race.staffAddedOnly")}
        </span>
        <span>{t("pft.race.pickEntries", { n: entries.length })}</span>
        <span>{t("pft.race.timingN", { n: timing.length })}</span>
        <span>{t("pft.race.finishedN", { n: finished.length })}</span>
      </div>
      {(offline || (isClient && pendingCount > 0)) && (
        <div className="rx-pft-local" role="status">
          <WifiOff size={15} />
          <span>
            {offline && t("pft.race.offline")}
            {offline && isClient && pendingCount > 0 && " · "}
            {isClient && pendingCount > 0 && t("pft.race.staffPending", { n: pendingCount })}
          </span>
        </div>
      )}
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {notice && (
        <p role="status" className="rx-hint">
          {notice}
        </p>
      )}

      {!closed && (
        <div className="rx-pft-staff-top">
          <Panel title={t("pft.race.staffAdd")} action={<Users size={19} />}>
            <p className="rx-pft-help">{t("pft.race.staffAddDesc")}</p>
            <div className="rx-find rx-pft-member-search">
              <Search size={17} />
              <Input
                type="search"
                aria-label={t("pft.race.staffSearchPh")}
                placeholder={t("pft.race.staffSearchPh")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="rx-pft-member-results">
              {results?.map((r) => (
                <div className="rx-pft-member" key={r.user_id}>
                  <span className="rx-avatar">{r.name.slice(0, 1)}</span>
                  <span>
                    <b>{r.name}</b>
                    <small>{r.joined ? t("pft.race.staffJoined") : race.crew ?? ""}</small>
                  </span>
                  {!r.joined && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || closed}
                      aria-label={`${r.name} ${t("pft.race.staffAddBtn")}`}
                      onClick={() => add(r.user_id)}
                    >
                      <Plus size={15} />
                      {t("pft.race.staffAddBtn")}
                    </Button>
                  )}
                </div>
              ))}
              {results && !results.length && (
                <div className="rx-pft-small-empty">{t("pft.race.staffNoResult")}</div>
              )}
            </div>
            <Hint>{t("pft.race.staffHint")}</Hint>
          </Panel>

          <Panel
            title={t("pft.race.staffWave")}
            action={<Chip tone="yellow">{t("pft.race.selectedN", { n: selectedWaiting.length })}</Chip>}
          >
            <p className="rx-pft-help">{t("pft.race.staffWaveDesc")}</p>
            <div className="rx-pft-wave-picks">
              {WAVES.map((wave) => {
                const athletes = waveGroups.find((g) => g.wave === wave)?.rows ?? [];
                const active = athletes.length > 0 && athletes.every((a) => selected.includes(a.entry_id));
                return (
                  <Button
                    key={wave}
                    variant="outline"
                    disabled={busy || closed || !athletes.length}
                    className={active ? "selected" : ""}
                    // 누르면 **선택만** 한다 — 출발은 아래 큰 버튼으로. 한 번 더 확인하고
                    // 내보내야 오출발이 나지 않는다(2026-09-13 운영 피드백).
                    onClick={() => setSelected(athletes.map((a) => a.entry_id))}
                  >
                    {t("pft.race.waveN", { n: wave })}
                    <small>{athletes.length}</small>
                  </Button>
                );
              })}
            </div>
            <div className="rx-pft-select-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || closed || !waiting.length}
                onClick={() => setSelected(waiting.map((a) => a.entry_id))}
              >
                {t("pft.race.staffSelectAll")}
              </Button>
              <Button variant="ghost" size="sm" disabled={!selected.length} onClick={() => setSelected([])}>
                {t("pft.race.staffClear")}
              </Button>
            </div>
            <div className="rx-pft-waiting-list">
              {waiting.map((a) => (
                <label key={a.entry_id}>
                  <Checkbox
                    disabled={busy || closed}
                    checked={selected.includes(a.entry_id)}
                    onCheckedChange={(checked) => select(a.entry_id, checked === true)}
                  />
                  <b>{a.name}</b>
                  {a.scaled && <Chip>{t("pft.scaledTag")}</Chip>}
                  <Chip>{a.wave ? t("pft.race.waveN", { n: a.wave }) : t("pft.race.waveNone")}</Chip>
                </label>
              ))}
              {!waiting.length && (
                <p className="rx-pft-small-empty">{t("pft.race.staffNoWaiting")}</p>
              )}
            </div>
            <div className="rx-pft-assign">
              <span>{t("pft.race.waveAssignTo")}</span>
              <div>
                {[...WAVES, null].map((wave) => (
                  <Button
                    key={wave ?? "none"}
                    variant="outline"
                    size="sm"
                    disabled={busy || closed || !selectedWaiting.length}
                    aria-label={wave ? t("pft.race.waveN", { n: wave }) : t("pft.race.waveNone")}
                    onClick={() => assignWave(wave)}
                  >
                    {wave ?? t("pft.race.waveNone")}
                  </Button>
                ))}
              </div>
            </div>
            <Hint>{t("pft.race.waveHint")}</Hint>
            <Button
              className="rx-primary rx-pft-start"
              disabled={busy || closed || !selectedWaiting.length}
              onClick={() => startEntries(selectedWaiting.map((a) => a.entry_id))}
            >
              <Play size={19} />
              {t("pft.race.startTogether", { n: selectedWaiting.length })}
            </Button>
          </Panel>
        </div>
      )}

      <div className="rx-subhead">
        <div>
          <h2>
            {t("pft.race.athletes")} <span className="rx-pft-count">{entries.length}</span>
          </h2>
          <p>{closed ? t("pft.race.closedLocked") : t("pft.race.staffHint")}</p>
        </div>
        <span className="rx-pft-active-label">
          {closed
            ? t("pft.race.closedRace")
            : timing.length
              ? t("pft.race.timingN", { n: timing.length })
              : t("pft.race.waitingStart")}
        </span>
      </div>

      <div className="rx-pft-athletes">
        {entries.map((e) => {
          const state = entryState(e);
          const mine = isClient ? (pending[e.entry_id] ?? []) : [];
          const splits = [...e.splits, ...mine];
          const current = splits.length;
          const done = state === "finished" || current >= PFT_STATIONS.length;
          // 명시적 중도포기 또는 종료된 레이스의 미완주 — 어느 쪽이든 경과가 흐르면 안 된다
          const quit = state === "dnf";
          const dnf = quit || (closed && state !== "finished");
          const elapsed = e.started_at && !closed && !quit ? Math.max(0, now - Date.parse(e.started_at)) : 0;
          const total = e.total_ms ?? (done ? splits[splits.length - 1] : null);
          const timingNow = state === "running" && !done && !dnf;
          const cls = dnf ? "dnf" : state === "running" ? "timing" : state;
          return (
            <Panel key={e.entry_id} className={`rx-pft-athlete ${cls}`}>
              <div className="rx-pft-athlete-head">
                <div>
                  <h3>{e.name}</h3>
                  <span>
                    {stateLabel(e)}
                    {e.wave ? ` · ${t("pft.race.waveN", { n: e.wave })}` : ""}
                    {e.scaled ? ` · ${t("pft.scaledTag")}` : ""}
                    {mine.length > 0 ? ` · ${t("pft.race.staffPending", { n: mine.length })}` : ""}
                  </span>
                </div>
                <strong>
                  {state === "finished"
                    ? formatMs(total)
                    : dnf
                      ? "—"
                      : state === "running"
                        ? fmtClock(elapsed)
                        : "0:00.0"}
                </strong>
              </div>
              <PftSplitStrip splits={splits} />
              {timingNow && (
                <div className="rx-pft-current-stage">
                  <span style={{ background: PFT_COLORS[PFT_STATIONS[current].key] }}>{current + 1}</span>
                  <b>{stationLabel(current)}</b>
                  <small>{t(PFT_STATIONS[current].amount as DictKey)}</small>
                </div>
              )}
              <div className="rx-pft-athlete-controls">
                {state === "waiting" && !closed ? (
                  <label className="rx-pft-check">
                    <Checkbox
                      disabled={busy}
                      checked={selected.includes(e.entry_id)}
                      onCheckedChange={(checked) => select(e.entry_id, checked === true)}
                    />
                    {t("pft.race.includeWave")}
                  </label>
                ) : timingNow && !closed ? (
                  <Button
                    className="rx-primary rx-wide"
                    // 버튼 색 = 지금 찍을 종목의 색. 구간 띠의 현재 칸과 같은 색이라
                    // 어느 종목을 찍는 중인지 색만으로 알아본다.
                    style={{ background: PFT_COLORS[PFT_STATIONS[current].key], borderColor: "transparent", color: "#1c2730" }}
                    onClick={() => tap(e)}
                    aria-label={`${e.name} ${t("pft.race.staffTap", { station: stationLabel(current) })}`}
                  >
                    <Check size={17} />
                    {t("pft.race.staffTap", { station: stationLabel(current) })}
                  </Button>
                ) : state === "running" && done ? (
                  <Chip tone="yellow">{t("pft.race.staffPending", { n: mine.length })}</Chip>
                ) : state === "finished" ? (
                  <Chip tone="green">
                    <Check size={14} />
                    {t("pft.race.allDone")}
                  </Chip>
                ) : dnf ? (
                  <Chip>{t("pft.race.dnf")}</Chip>
                ) : (
                  <Chip>{t("pft.race.closedLocked")}</Chip>
                )}
                {!closed && (
                  <div className="rx-pft-athlete-bottom">
                    {(state === "running" || state === "finished") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || (!splits.length && state !== "finished")}
                        aria-label={`${e.name} ${t(state === "finished" ? "pft.race.undoFinish" : "pft.mUndo")}`}
                        onClick={() => undo(e)}
                      >
                        <Undo2 size={14} />
                        {t(state === "finished" ? "pft.race.undoFinish" : "pft.mUndo")}
                      </Button>
                    )}
                    {(state === "running" || quit) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || mine.length > 0}
                        onClick={() => setConfirm({ kind: "reset", entry: e })}
                      >
                        <RotateCcw size={14} />
                        {t("pft.mReset")}
                      </Button>
                    )}
                    {/* 중도포기 — 출발한 사람만. 누르면 시계가 멈추고 보드에서도 빠진다 */}
                    {(state === "running" || quit) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={quit ? "" : "rx-pft-close"}
                        disabled={busy}
                        onClick={() => (quit ? setDnf(e, false) : setConfirm({ kind: "dnf", entry: e }))}
                      >
                        {quit ? t("pft.race.dnfUndo") : t("pft.race.dnfMark")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || timingNow}
                      aria-label={`${e.name} ${t("pft.race.staffRemove")}`}
                      onClick={() => setConfirm({ kind: "remove", entry: e })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
      {!entries.length && (
        <Panel>
          <p>{t("pft.race.noEntries")}</p>
        </Panel>
      )}

      <div className="rx-pft-footnote">
        <p>
          {t("pft.race.staffDesc")}
          {timing.length > 0 ? ` ${t("pft.race.timingN", { n: timing.length })}` : ""}
        </p>
      </div>

      <RoxDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.kind === "remove"
            ? t("pft.race.removeTitle", { name: confirm.entry.name })
            : confirm?.kind === "reset"
              ? t("pft.race.resetTitle", { name: confirm.entry.name })
              : confirm?.kind === "dnf"
                ? t("pft.race.dnfTitle", { name: confirm.entry.name })
                : t("pft.race.closeTitle")
        }
        description={
          confirm?.kind === "remove"
            ? t("pft.race.staffRemoveConfirm", { name: confirm.entry.name })
            : confirm?.kind === "reset"
              ? t("pft.race.staffResetConfirm", { name: confirm.entry.name })
              : confirm?.kind === "dnf"
                ? t("pft.race.dnfConfirm", { name: confirm.entry.name })
                : t("pft.race.manageDesc")
        }
      >
        <div className="rx-actions">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            {t("common.cancel")}
          </Button>
          <Button className={confirm?.kind === "close" ? "rx-pft-close" : "rx-primary"} variant={confirm?.kind === "close" ? "outline" : "default"} onClick={confirmAction}>
            {confirm?.kind === "remove"
              ? t("pft.race.removeBtn")
              : confirm?.kind === "reset"
                ? t("pft.mReset")
                : confirm?.kind === "dnf"
                  ? t("pft.race.dnfMark")
                  : t("pft.race.close")}
          </Button>
        </div>
      </RoxDialog>
    </div>
  );
}
