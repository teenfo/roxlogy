"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { PFT_COLORS, PFT_STATIONS, badgeClass, badgeDictKey } from "@/lib/pft";
import { fmtClock, rankEntries, type BoardData } from "@/lib/pft-race";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/**
 * 공개 레이스 보드 — 현장 TV·프로젝터용. 로그인 없이 코드로 연다.
 * 갱신: Realtime(pft_race_entries 변경)을 "다시 읽으라는 신호"로 쓰고, 5초 폴링을 예비로 둔다.
 * 시계: 첫 응답의 server_now 로 오프셋을 재서 진행 중 참가자의 경과가 보드에서 흐른다.
 */
export function PftRaceBoard({ initial }: { initial: BoardData }) {
  const { t } = useI18n();
  const [data, setData] = useState<BoardData>(initial);
  const [offline, setOffline] = useState(false);
  // 서버 시각 − 폰 시각. effect 에서 채운다(렌더 중 Date.now() 호출 금지 — react-hooks/purity)
  const offsetRef = useRef(0);
  // 250ms 틱 — 렌더 중 Date.now() 를 부르지 않기 위해 상태로 둔다
  const [now, setNow] = useState(() => Date.parse(initial.server_now));
  const code = initial.race.code;
  const raceId = initial.race.id;

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
  const leader = rows.find((r) => r.state === "finished");
  const running = rows.filter((r) => r.state === "running").length;
  const finished = rows.filter((r) => r.state === "finished").length;
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 md:px-8 md:py-6">
      {/* 헤더 */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-accent">
            {t("pft.race.board")}
            {data.race.crew && <span className="ml-2 text-muted">{data.race.crew}</span>}
          </p>
          <h1 className="mt-1 truncate text-2xl font-extrabold tracking-tight md:text-4xl">
            {data.race.title}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="rounded-lg border border-line-strong bg-control px-3 py-1.5 font-mono text-lg font-extrabold tracking-[0.25em] text-foreground">
            {data.race.code}
          </span>
          <span
            className={`rounded-md px-2 py-1 text-xs font-bold ${
              data.race.status === "closed" ? "bg-line text-muted" : "bg-success-bg text-success"
            }`}
          >
            {t(data.race.status === "closed" ? "pft.race.closed" : "pft.race.open")}
          </span>
          {isClient && offline && (
            <span role="status" className="text-xs text-danger">
              {t("pft.race.offline")}
            </span>
          )}
        </div>
      </header>

      <p className="text-sm text-muted" role="status">
        {t("pft.race.boardSummary", { total: rows.length, running, finished })}
      </p>

      {/* 참가자 표 */}
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card px-4 py-10 text-center text-muted">
          {t("pft.race.noEntries")}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((r) => {
            const gap =
              r.state === "finished" && leader && r.total_ms != null && leader.total_ms != null
                ? r.total_ms - leader.total_ms
                : null;
            return (
              <li
                key={r.entry_id}
                className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-3 py-3 md:grid-cols-[56px_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:gap-5 md:px-5 ${
                  r.state === "running"
                    ? "border-line-accent bg-highlight"
                    : r.state === "finished"
                      ? "border-line bg-card"
                      : "border-line-soft bg-card opacity-60"
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-black md:h-12 md:w-12 md:text-2xl ${
                    r.rank === 1 && r.state === "finished"
                      ? "bg-accent text-background"
                      : r.state === "waiting"
                        ? "bg-line text-muted"
                        : "bg-control text-foreground"
                  }`}
                  aria-label={r.rank ? `#${r.rank}` : t("pft.race.waiting")}
                >
                  {r.rank || "–"}
                </span>

                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-extrabold md:text-2xl">{r.name}</span>
                    {r.scaled && (
                      <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                        {t("pft.scaledTag")}
                      </span>
                    )}
                    {r.badge && (
                      <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${badgeClass(r.badge)}`}>
                        {t(badgeDictKey(r.badge))}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {r.state === "running" && r.current != null
                      ? t("pft.race.nowAt", {
                          n: r.current + 1,
                          station: t(PFT_STATIONS[r.current].label as DictKey),
                        })
                      : r.state === "finished"
                        ? t("pft.race.finished")
                        : t("pft.race.waiting")}
                  </span>
                </span>

                {/* 6칸 진행 — 색은 종목별, 찍힌 칸은 채움, 진행 중 칸은 테두리 */}
                <span
                  className="col-span-3 grid grid-cols-6 gap-1 md:col-span-1"
                  aria-label={t("pft.race.progressLabel", { done: r.splits.length })}
                >
                  {PFT_STATIONS.map((st, i) => {
                    const done = i < r.splits.length;
                    const cur = r.state === "running" && i === r.current;
                    const ms = done ? r.splits[i] - (i === 0 ? 0 : r.splits[i - 1]) : null;
                    return (
                      <span key={st.key} className="flex flex-col items-center gap-1">
                        <span
                          className={`h-2.5 w-full rounded-full ${cur ? "motion-safe:animate-pulse" : ""}`}
                          style={{
                            background: done ? PFT_COLORS[st.key] : cur ? "var(--accent)" : "var(--line)",
                          }}
                        />
                        <span className="tabular text-[10px] text-muted md:text-xs">
                          {ms != null ? formatMs(ms) : ""}
                        </span>
                      </span>
                    );
                  })}
                </span>

                <span className="text-right">
                  <span
                    className={`tabular block font-black leading-none ${
                      r.state === "running" ? "text-2xl text-accent md:text-4xl" : "text-xl md:text-3xl"
                    }`}
                  >
                    {r.elapsed == null
                      ? "–:––"
                      : r.state === "running"
                        ? fmtClock(r.elapsed)
                        : formatMs(r.elapsed)}
                  </span>
                  {gap != null && gap > 0 && (
                    <span className="tabular mt-1 block text-xs text-muted md:text-sm">
                      +{formatMs(gap)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{t("pft.race.joinHint", { code: data.race.code })}</span>
        <Link href="/pft/race/join" className="font-semibold text-accent hover:underline">
          {t("pft.race.joinCta")}
        </Link>
      </footer>
    </div>
  );
}
