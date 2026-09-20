"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Monitor, Share2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { PFT_STATIONS } from "@/lib/pft";
import { PftMeasureView, type PftBest } from "@/components/pft-measure-view";
import type { MyEntry, RaceInfo } from "@/lib/pft-race";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, Go, Hint, Panel } from "@/components/rox/ui";

/**
 * 레이스 참가자 화면 — 시안 pft-race.tsx 의 PftRaceOverview(레이스 현황 Panel: 상태 칩·코드·
 * Hint·스태프/라이브보드 버튼) 위에, 일반 측정과 같은 PftMeasureView(시안 .rx-stopwatch)를 잇는다
 * (PORT_PLAN §3-d). 시안의 "나의 참가 상태" Panel 은 스톱워치 패널이 대신한다.
 *
 * 다른 점은 저장 위치뿐: 시작·종목 완료가 레이스 서버에 동기화되고, 6번째 완료에서
 * 서버가 기록(pft_results)을 자동 생성한다. 파트너가 이 폰을 들고 눌러 준다.
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
  best = null,
  joinBlocked = false,
}: {
  race: RaceInfo;
  initialEntry: MyEntry | null;
  serverNow: string;
  canManage: boolean;
  defaultAge: number | null;
  best?: PftBest | null;
  /** 프로필 필수값(출생연도·성별)이 비어 참가를 막아야 하는가 — 안내는 페이지가 띄운다 */
  joinBlocked?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const KEY = `roxlogy.pft.race.${race.code}`;

  const [entry, setEntry] = useState<MyEntry | null>(initialEntry);
  const [status, setStatus] = useState(race.status);
  const [joinOpen, setJoinOpen] = useState(race.join_open);
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
  // 서버 시각 − 폰 시각. effect 에서 채운다(렌더 중 Date.now() 호출 금지)
  const offsetRef = useRef(0);

  const joined = !!entry;
  const finished = !!entry?.finished_at;
  const serverSplits = entry?.splits ?? [];
  // 화면상의 스플릿 = 서버에 있는 것 + 아직 못 보낸 것
  const splits = [...serverSplits, ...local.pending];
  const running = joined && local.startedLocal != null && !finished && !!entry?.started_at;
  const done = splits.length >= PFT_STATIONS.length;
  const quit = !!entry?.dnf_at && !finished;
  const closed = status === "closed";
  // 코드는 "아직 참가하지 않은 사람"에게만 필요하다 — 이미 참가했으면 다시 보여 주지 않는다.
  // (운영진은 불러 줘야 하므로 계속 보인다. 코드 없는 레이스는 아무에게도 보이지 않는다.)
  const showCode = joinOpen && (!joined || canManage);
  // 뷰에 주는 시작 시각 — 서버가 시작을 알 때만 (스태프가 초기화하면 다시 대기)
  const startedAt = joined && entry?.started_at && local.startedLocal != null ? local.startedLocal : null;

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

  useEffect(() => {
    offsetRef.current = Date.parse(serverNow) - Date.now();
  }, [serverNow]);

  // 다른 기기(스태프 타이밍·파트너 폰)에서 찍은 변화와 레이스 종료를 따라간다.
  // 완주한 뒤에도 멈추지 않는다 — 멈추면 그 사이 레이스가 종료돼도 이 화면은 모르고
  // "완주 취소" 같은 버튼을 계속 내주게 된다(서버는 거부하므로 헛손질이 된다).
  useEffect(() => {
    if (!joined) return;
    const supabase = createClient();
    let cancelled = false;
    const sync = async () => {
      const { data: mine } = await supabase.rpc("pft_race_my_entry", { p_race: race.id });
      if (cancelled || !mine) return;
      const m = mine as MyEntry;
      setEntry(m);
      setStatus(m.status);
      if (m.started_at && local.startedLocal == null) {
        // 스태프가 출발시킨 경우: 서버 시작 시각을 이 폰 시계로 역산
        persist({ startedLocal: Date.parse(m.started_at) - offsetRef.current, pending: [] });
      } else if (!m.started_at && local.startedLocal != null && !local.pending.length) {
        // 스태프가 초기화한 경우
        persist({ startedLocal: null, pending: [] });
      }
    };
    // 완주 뒤에는 바뀔 일이 드물어 간격을 늘린다(종료 반영은 15초면 충분하다)
    const id = window.setInterval(() => void sync(), finished ? 15000 : 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, finished, race.id, local.startedLocal, local.pending.length]);

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
    if (splits.length && !window.confirm(t("pft.resetConfirm"))) return;
    const j = (await call("pft_race_reset", { p_race: race.id })) as MyEntry | null;
    if (!j) return;
    setEntry(j);
    persist({ startedLocal: null, pending: [] });
  };

  const setJoinMode = async (next: boolean) => {
    const j = (await call("pft_race_set_join_open", { p_race: race.id, p_open: next })) as
      | { ok?: boolean }
      | null;
    if (!j?.ok) return;
    setJoinOpen(next);
    setNotice(t(next ? "pft.race.joinOpenedDone" : "pft.race.joinClosedDone"));
    router.refresh();
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

  /** 자가 중도포기 — 현장에서 그만둘 때. 서버가 출발 전·완주자·종료된 레이스를 막는다. */
  const setMyDnf = async (on: boolean) => {
    if (on && !window.confirm(t("pft.race.dnfSelfConfirm"))) return;
    const j = (await call("pft_race_dnf", { p_race: race.id, p_on: on })) as MyEntry | null;
    if (!j?.entry_id) return;
    setEntry(j);
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

  return (
    <PftMeasureView
      title={race.title}
      description={!joined ? t("pft.race.joinDesc") : running && !done ? t("pft.race.partnerHint") : undefined}
      startedAt={quit ? null : startedAt}
      splits={splits}
      now={now}
      scaled={scaled}
      defaultAge={defaultAge}
      best={best}
      busy={busy}
      err={err}
      startDisabled={closed}
      completeDisabled={closed}
      undoDisabled={closed}
      resetDisabled={closed || local.pending.length > 0}
      onStart={start}
      onComplete={tap}
      onUndo={undo}
      onReset={reset}
      hideTimer={!joined}
      headerExtra={
        <div className="rx-actions">
          <Go href={`/board/${race.code}`}>
            <Monitor size={16} />
            {t("pft.race.openBoard")}
          </Go>
          <Button variant="outline" type="button" onClick={copyBoard}>
            <Share2 size={16} />
            {copied ? t("common.copied") : t("pft.race.share")}
          </Button>
        </div>
      }
      beforeClock={
        <>
          {notice && (
            <p role="status" className="rx-hint">
              {notice}
            </p>
          )}
          <Panel title={t("pft.race.status")}>
            <div className="rx-actions">
              <Chip tone={closed ? "neutral" : "green"}>
                {t(closed ? "pft.race.closed" : "pft.race.open")}
              </Chip>
              {showCode && <Chip>{race.code}</Chip>}
              {race.crew && <Chip>{race.crew}</Chip>}
              {joined && quit && <Chip tone="red">{t("pft.race.dnf")}</Chip>}
            </div>
            <Hint>
              {!joined
                ? joinOpen
                  ? t("pft.race.joinDesc")
                  : t("pft.race.staffAddedOnly")
                : closed
                  ? t("pft.race.closedNote")
                  : quit
                    ? t("pft.race.dnfSelfNote")
                    : t("pft.race.partnerHint")}
            </Hint>
            {!joined && joinOpen && (
              <Button
                className="rx-primary"
                type="button"
                onClick={join}
                disabled={busy || closed || joinBlocked}
              >
                {t("pft.race.join")}
              </Button>
            )}
            {joined && startedAt == null && !quit && (
              <label className="rx-check">
                <Checkbox checked={scaled} onCheckedChange={(v) => setScaled(v === true)} />
                {t("pft.fScaled")}
              </label>
            )}
            {/* 중도포기 — 출발했고 아직 완주하지 않은 사람만. 눌러도 기록은 지우지 않는다 */}
            {joined && (running || quit) && !closed && (
              <div className="rx-actions">
                <Button
                  variant="outline"
                  type="button"
                  className={quit ? "" : "rx-pft-close"}
                  onClick={() => setMyDnf(!quit)}
                  disabled={busy}
                >
                  {quit ? t("pft.race.dnfUndo") : t("pft.race.dnfMark")}
                </Button>
              </div>
            )}
          </Panel>
        </>
      }
      clockNote={
        local.pending.length > 0 ? (
          <p role="status" className="rx-hint">
            {t("pft.race.syncPending", { n: local.pending.length })}
          </p>
        ) : undefined
      }
      finishExtra={
        <>
          <Hint>
            {local.pending.length > 0
              ? t("pft.race.syncPending", { n: local.pending.length })
              : entry?.result_id
                ? t("pft.race.savedNote")
                : t("pft.race.notSavedNote")}
          </Hint>
          <div className="rx-actions">
            <Go href="/pft" primary>
              {t("pft.title")}
            </Go>
            {!closed && finished && (
              <Button variant="outline" type="button" onClick={undo} disabled={busy}>
                {t("pft.race.undoFinish")}
              </Button>
            )}
          </div>
        </>
      }
      afterList={
        canManage ? (
          <Panel title={t("pft.race.manage")}>
            <p>
              {t("pft.race.manageDesc")}{" "}
              {t(joinOpen ? "pft.race.joinModeOpenNow" : "pft.race.joinModeClosedNow", { code: race.code })}
            </p>
            <div className="rx-actions" style={{ marginTop: 16 }}>
              <Go href={`/pft/race/${race.code}/staff`} primary>
                {t("pft.race.staffOpen")}
              </Go>
              <Button variant="outline" type="button" onClick={() => setJoinMode(!joinOpen)} disabled={busy}>
                {t(joinOpen ? "pft.race.joinModeClose" : "pft.race.joinModeOpen")}
              </Button>
              {closed ? (
                <Button variant="outline" type="button" onClick={() => setRaceStatus("open")} disabled={busy}>
                  {t("pft.race.reopen")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  type="button"
                  className="rx-pft-close"
                  onClick={() => setRaceStatus("closed")}
                  disabled={busy}
                >
                  {t("pft.race.close")}
                </Button>
              )}
            </div>
          </Panel>
        ) : undefined
      }
    />
  );
}
