"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { PFT_COLORS, PFT_CUTOFFS, PFT_STATIONS, badgeClass, badgeDictKey } from "@/lib/pft";
import {
  avatarColor,
  fmtClock,
  fmtWallClock,
  initialOf,
  rankEntries,
  segmentMs,
  segmentProgress,
  type BoardData,
  type RankedEntry,
} from "@/lib/pft-race";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * 공개 레이스 보드 — 현장 TV·프로젝터용(1920×1080 기준). 로그인 없이 코드로 연다.
 * 3분할: 상단 레이스 종합 / 하단 좌 "측정 중" 라이브 카드 / 하단 우 "완주 리더보드".
 * 갱신: Realtime(pft_race_entries 변경)을 "다시 읽으라는 신호"로 쓰고, 5초 폴링을 예비로 둔다.
 * 시계: 첫 응답의 server_now 로 오프셋을 재서 진행 중 참가자의 경과가 보드에서 흐른다.
 * 리더보드가 12행을 넘으면 스크롤 대신 8초마다 페이지를 넘긴다(현장 TV는 스크롤할 수 없다).
 */
const RUNNING_MAX = 6;
const PAGE_SIZE = 12;
const PAGE_MS = 8000;
const NEW_MS = 60_000;

export function PftRaceBoard({ initial, meId = null }: { initial: BoardData; meId?: string | null }) {
  const { t } = useI18n();
  const [data, setData] = useState<BoardData>(initial);
  const [offline, setOffline] = useState(false);
  const [page, setPage] = useState(0);
  // 서버 시각 − 폰 시각. effect 에서 채운다(렌더 중 Date.now() 호출 금지 — react-hooks/purity)
  const offsetRef = useRef(0);
  // 250ms 틱 — 렌더 중 Date.now() 를 부르지 않기 위해 상태로 둔다
  const [now, setNow] = useState(() => Date.parse(initial.server_now));
  const code = initial.race.code;
  const raceId = initial.race.id;
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    offsetRef.current = Date.parse(initial.server_now) - Date.now();
    const supabase = createClient();
    let cancelled = false;
    const refetch = async () => {
      const { data: d, error } = await supabase.rpc("pft_race_board", { p_code: code });
      if (cancelled) return;
      if (error || !d) {
        setOffline(true);
        return;
      }
      const b = d as BoardData;
      offsetRef.current = Date.parse(b.server_now) - Date.now();
      setOffline(false);
      setData(b);
    };
    const ch = supabase
      .channel(`pft-race-${raceId}`)
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
  }, [code, raceId, initial.server_now]);

  const rows = rankEntries(data.entries, now);
  const running = rows.filter((r) => r.state === "running");
  const finished = rows.filter((r) => r.state === "finished");
  const waiting = rows.filter((r) => r.state === "waiting");
  const leader = finished[0] ?? null;
  const closed = data.race.status === "closed";
  // 이미 참가한 사람에게는 코드를 다시 묻지 않는다 — 코드 블록 대신 내 측정 화면으로 안내
  const joinedMe = meId != null && data.entries.some((e) => e.user_id === meId);
  const showCode = data.race.join_open && !closed && !joinedMe;
  const raceHref = `/pft/race/${data.race.code}`;

  // 리더보드 페이지 로테이션
  const pages = Math.max(1, Math.ceil(finished.length / PAGE_SIZE));
  useEffect(() => {
    if (pages <= 1) return;
    const id = window.setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS);
    return () => window.clearInterval(id);
  }, [pages]);
  const pageRows = finished.slice((page % pages) * PAGE_SIZE, (page % pages) * PAGE_SIZE + PAGE_SIZE);

  const stationLabel = (i: number) => t(PFT_STATIONS[i].label as DictKey);
  const dateLine = (() => {
    const d = new Date(data.race.created_at);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  })();
  const pill = "inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-extrabold";

  return (
    <div className="flex w-full flex-1 flex-col gap-5 px-4 py-4 md:px-7 md:py-6">
      {/* 1. 레이스 종합 카드 */}
      <section className="flex flex-wrap items-center gap-6 rounded-2xl border border-line-mid bg-card px-5 py-5 md:px-[26px]">
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:min-w-[320px]">
          <p className="flex items-center gap-2.5 text-xs font-extrabold tracking-[0.14em] text-accent">
            {t("pft.race.board")}
            {data.race.crew && <span className="text-[#8a7a2a]">{data.race.crew}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="truncate text-[28px] font-extrabold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              {data.race.title}
            </h1>
            <span
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-extrabold ${
                closed ? "bg-line text-muted" : "bg-success-bg text-success"
              }`}
            >
              {closed ? t("pft.race.ended") : `● ${t("pft.race.open")}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-sm text-muted">
            <span>{dateLine}</span>
            <span className="hidden text-[#444] md:inline" aria-hidden>
              |
            </span>
            <span className="inline-flex flex-wrap gap-1.5" aria-hidden>
              {PFT_STATIONS.map((st, i) => (
                <span key={st.key} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: PFT_COLORS[st.key] }} />
                  {stationLabel(i)}
                </span>
              ))}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3.5">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4" role="status">
            <Stat label={t("pft.race.stats.total")} value={String(rows.length)} />
            <Stat label={t("pft.race.stats.running")} value={String(running.length)} tone="accent" />
            <Stat label={t("pft.race.stats.finished")} value={String(finished.length)} tone="success" />
            <Stat
              label={t("pft.race.stats.best")}
              value={leader?.total_ms != null ? formatMs(leader.total_ms) : "–:––"}
              wide
            />
          </div>
          {showCode && (
            <div className="flex flex-col items-center gap-1.5 md:border-l md:border-line-mid md:pl-3.5">
              <span className="text-[11px] font-bold tracking-[0.06em] text-[#777]">{t("pft.race.codeLabel")}</span>
              <span className="flex h-[52px] items-center rounded-xl border border-line-strong bg-page px-5 font-mono text-2xl font-extrabold tracking-[0.32em]">
                {data.race.code}
              </span>
              <span className="text-[11px] text-[#8a7a2a]">{t("pft.race.joinUrlHint")}</span>
            </div>
          )}
          {joinedMe && (
            <div className="flex flex-col items-center gap-1.5 md:border-l md:border-line-mid md:pl-3.5">
              <span className="text-[11px] font-bold tracking-[0.06em] text-[#777]">{t("pft.race.youAreIn")}</span>
              <Link
                href={raceHref}
                className="flex h-[52px] items-center rounded-xl bg-accent px-5 text-sm font-extrabold text-background hover:brightness-110"
              >
                {t("pft.race.myScreen")}
              </Link>
            </div>
          )}
          {!data.race.join_open && !joinedMe && (
            <div className="flex flex-col items-center gap-1.5 md:border-l md:border-line-mid md:pl-3.5">
              <span className="max-w-[180px] text-center text-[11px] text-[#777]">{t("pft.race.staffAddedOnly")}</span>
            </div>
          )}
        </div>
      </section>

      {/* 2. 하단 그리드 */}
      <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* 2-1. 측정 중 */}
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-card">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <p className="flex items-center gap-2.5 text-[17px] font-extrabold">
              {t("pft.race.running")}
              <span className={`${pill} bg-highlight text-accent`}>{running.length}</span>
            </p>
            <span className="hidden text-xs text-[#777] md:inline">{t("pft.race.segHeader")}</span>
          </header>
          <div className="flex flex-1 flex-col gap-2.5 p-3.5 md:px-4">
            {running.length === 0 ? (
              <p className="flex flex-1 items-center justify-center py-10 text-sm text-muted">{t("pft.race.noRunning")}</p>
            ) : (
              running.slice(0, RUNNING_MAX).map((r) => (
                <LiveRow key={r.entry_id} r={r} now={now} leaderSplits={leader?.splits ?? null} stationLabel={stationLabel} />
              ))
            )}
            {running.length > RUNNING_MAX && (
              <p className="text-center text-xs text-muted">{t("pft.race.moreRunning", { n: running.length - RUNNING_MAX })}</p>
            )}
            {waiting.length > 0 && (
              <div className="mt-auto flex flex-wrap items-center gap-3 rounded-[14px] border border-dashed border-[#333] px-[18px] py-3 text-[13px] text-muted">
                <span className="font-bold text-[#c9c9c9]">{t("pft.race.waitingRow")}</span>
                {waiting.slice(0, 6).map((w) => (
                  <span key={w.entry_id} className="inline-flex items-center gap-1.5">
                    <Avatar name={w.name} size={22} />
                    {w.name}
                  </span>
                ))}
                {waiting.length > 6 && <span>+{waiting.length - 6}</span>}
                {showCode && (
                  <span className="ml-auto text-[#777]">{t("pft.race.joinHint", { code: data.race.code })}</span>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 2-2. 완주 리더보드 */}
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-card">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <p className="flex items-center gap-2.5 text-[17px] font-extrabold">
              {t("pft.race.finishedBoard")}
              <span className={`${pill} bg-success-bg text-success`}>{finished.length}</span>
            </p>
            {pages > 1 && (
              <span className="tabular text-xs text-[#777]" role="status">
                {t("pft.race.pageOf", { page: (page % pages) + 1, total: pages })}
              </span>
            )}
          </header>
          <div
            className="grid grid-cols-[44px_minmax(0,1fr)_auto] gap-3.5 border-b border-[#1c1c1c] px-5 py-2 text-[11px] font-bold tracking-[0.06em] text-[#777] md:grid-cols-[52px_minmax(0,1fr)_auto_auto]"
            aria-hidden
          >
            <span>{t("pft.race.colRank")}</span>
            <span>{t("pft.race.colAthlete")}</span>
            <span className="hidden w-16 text-right md:block">{t("pft.race.colBadge")}</span>
            <span className="w-[90px] text-right md:w-[110px]">{t("pft.race.colTime")}</span>
          </div>
          <ol className="flex flex-1 flex-col">
            {finished.length === 0 && (
              <li className="flex flex-1 items-center justify-center py-10 text-sm text-muted">{t("pft.race.noFinished")}</li>
            )}
            {pageRows.map((r) => {
              const gap = leader && r.total_ms != null && leader.total_ms != null ? r.total_ms - leader.total_ms : 0;
              const isMe = meId != null && r.user_id === meId;
              const isNew = isClient && !!r.finished_at && now - Date.parse(r.finished_at) < NEW_MS;
              return (
                <li
                  key={r.entry_id}
                  className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[#1c1c1c] px-5 py-3 md:grid-cols-[52px_minmax(0,1fr)_auto_auto] motion-safe:animate-[rowin_.3s_ease-out] ${
                    isMe ? "bg-highlight" : ""
                  }`}
                >
                  <span
                    className={`tabular flex h-10 w-10 items-center justify-center rounded-full border text-[17px] font-extrabold ${
                      r.rank === 1
                        ? "border-accent bg-accent text-background"
                        : r.rank <= 3
                          ? "border-line-accent bg-highlight text-accent"
                          : "border-[#333] text-muted"
                    }`}
                  >
                    {r.rank}
                  </span>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="hidden sm:inline-flex">
                      <Avatar name={r.name} size={40} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-lg font-extrabold">{r.name}</span>
                        {isMe && (
                          <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold text-background">
                            {t("pft.race.meTag")}
                          </span>
                        )}
                        {isNew && (
                          <span className="rounded bg-success-bg px-1.5 py-0.5 text-[10px] font-extrabold text-success">
                            {t("pft.race.newTag")}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-[#777]">
                        {r.badge && (
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold md:hidden ${badgeClass(r.badge)}`}>
                            {t(badgeDictKey(r.badge))}
                          </span>
                        )}
                        <span className="truncate">
                          {r.scaled
                            ? t("pft.scaledTag")
                            : r.finished_at
                              ? t("pft.race.finishedAt", { time: fmtWallClock(new Date(r.finished_at), false) })
                              : ""}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="hidden w-16 justify-end md:flex">
                    {r.badge && (
                      <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-extrabold ${badgeClass(r.badge)}`}>
                        {t(badgeDictKey(r.badge))}
                      </span>
                    )}
                  </span>
                  <span className="w-[90px] text-right md:w-[110px]">
                    <span
                      className={`tabular block text-[22px] font-extrabold leading-[1.1] md:text-[26px] ${r.rank === 1 ? "text-accent" : ""}`}
                    >
                      {formatMs(r.total_ms)}
                    </span>
                    <span className="tabular mt-0.5 block text-xs text-[#777]">
                      {r.rank === 1 ? t("pft.race.leader") : `+${fmtClock(gap)}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-xs text-[#777]">
            <span>
              {t("pft.race.badgeRule", {
                gold: formatMs(PFT_CUTOFFS.under45.gold),
                silver: formatMs(PFT_CUTOFFS.under45.silver),
              })}
            </span>
            {joinedMe ? (
              <Link href={raceHref} className="font-bold text-accent hover:underline">
                {t("pft.race.myScreen")} →
              </Link>
            ) : showCode ? (
              <Link href={raceHref} className="font-bold text-accent hover:underline">
                {t("pft.race.joinCta")} →
              </Link>
            ) : meId ? (
              <Link href="/pft" className="font-bold text-accent hover:underline">
                {t("pft.race.allResults")}
              </Link>
            ) : null}
          </footer>
        </section>
      </div>

      {isClient && offline && (
        <p role="status" className="text-xs text-danger">
          {t("pft.race.offline")}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: string;
  tone?: "accent" | "success";
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-center ${wide ? "min-w-[110px]" : "min-w-[88px]"} ${
        tone === "accent" ? "border-line-accent bg-highlight" : "border-line bg-page"
      }`}
    >
      <p className={`text-[11px] font-bold tracking-[0.06em] ${tone === "accent" ? "text-[#c9b34a]" : "text-[#777]"}`}>{label}</p>
      <p
        className={`tabular mt-1 text-[28px] font-extrabold leading-[1.1] ${
          tone === "accent" ? "text-accent" : tone === "success" ? "text-success" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-[#111]"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: Math.round(size * 0.4) }}
    >
      {initialOf(name)}
    </span>
  );
}

/** 측정 중 선수 카드 — 현재 스테이션 배지 + 6구간 진행 바 + 큰 경과 타이머 */
function LiveRow({
  r,
  now,
  leaderSplits,
  stationLabel,
}: {
  r: RankedEntry;
  now: number;
  leaderSplits: number[] | null;
  stationLabel: (i: number) => string;
}) {
  const { t } = useI18n();
  const cur = r.current ?? 0;
  const elapsed = r.elapsed ?? 0;
  const curElapsed = elapsed - (cur === 0 ? 0 : r.splits[cur - 1]);
  const progress = segmentProgress(r, curElapsed, leaderSplits);
  const fresh = !!r.started_at && now - Date.parse(r.started_at) < 30_000;
  return (
    <div
      className={`grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3.5 rounded-[14px] border bg-page px-4 py-3.5 md:grid-cols-[56px_minmax(0,1fr)_auto] md:gap-[18px] md:px-[18px] motion-safe:animate-[rowin_.3s_ease-out] ${
        fresh ? "border-line-accent" : "border-line"
      }`}
    >
      <Avatar name={r.name} size={44} />
      <div className="flex min-w-0 flex-col gap-2 md:gap-[9px]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate text-lg font-extrabold md:text-[22px]">{r.name}</span>
          {r.scaled && (
            <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">{t("pft.scaledTag")}</span>
          )}
          <span className="hidden h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-highlight px-2.5 text-xs font-extrabold text-accent md:inline-flex">
            {cur + 1}/6 {stationLabel(cur)}
          </span>
          <span className="tabular shrink-0 text-[26px] font-extrabold leading-none md:hidden">{fmtClock(elapsed)}</span>
        </div>
        <span className="inline-flex h-6 w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-highlight px-2.5 text-xs font-extrabold text-accent md:hidden">
          {cur + 1}/6 {stationLabel(cur)}
        </span>
        <div className="grid grid-cols-3 gap-1.5 md:grid-cols-6" aria-label={t("pft.race.progressLabel", { done: r.splits.length })}>
          {PFT_STATIONS.map((st, i) => {
            const done = i < r.splits.length;
            const isCur = i === cur;
            const ms = segmentMs(r.splits, i);
            const width = done ? 100 : isCur ? (progress ?? 100) : 0;
            return (
              <div key={st.key} className="flex flex-col gap-1.5">
                <div className="relative h-2.5 overflow-hidden rounded-[5px] bg-[#1c1c1c]">
                  <div
                    className={`h-full rounded-[5px] transition-[width] duration-500 ease-linear ${
                      isCur && progress == null ? "motion-safe:animate-pulse" : ""
                    }`}
                    style={{ width: `${width}%`, background: PFT_COLORS[st.key], opacity: done || isCur ? 1 : 0.4 }}
                  />
                </div>
                <div className="tabular flex justify-between text-xs">
                  <span className="truncate text-[#777]">{stationLabel(i)}</span>
                  <span className={`font-bold ${done ? "text-[#c9c9c9]" : isCur ? "text-accent" : "text-[#555]"}`}>
                    {done && ms != null ? formatMs(ms) : isCur ? fmtClock(curElapsed) : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="hidden min-w-[120px] text-right md:block">
        <p className="text-[11px] font-bold tracking-[0.06em] text-[#777]">{t("pft.race.elapsedLabel")}</p>
        <p className="tabular text-4xl font-extrabold leading-[1.1]">{fmtClock(elapsed)}</p>
      </div>
    </div>
  );
}
