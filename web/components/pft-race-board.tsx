"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Flag, Maximize, Minimize } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs } from "@/lib/format";
import { PFT_COLORS, PFT_CUTOFFS, PFT_STATIONS, badgeDictKey } from "@/lib/pft";
import {
  entryState,
  fmtClock,
  groupByWave,
  hasWaves,
  initialOf,
  rankEntries,
  segmentMs,
  type BoardData,
  type RaceEntry,
  type RankedEntry,
} from "@/lib/pft-race";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { PftSplitStrip } from "@/components/pft-splits";

/**
 * 공개 레이스 보드 — 시안 pft-race.tsx 의 PftLiveBoard 그대로 (PORT_PLAN §3-d, 스펙 §15):
 * .rx-live-board[ header.rx-live-topbar(브랜드·상태·전체화면) · main.rx-live-main[
 * section.rx-live-racehead(제목·종목 6장·지표 4개) · .rx-live-grid[ 참가 선수(조별) | 측정 중 |
 * 완주 순위 ] · footer.rx-live-footer ] ]. 앱이 밝아져도 여기는 전용 다크 화면이다.
 *
 * 현장 TV·프로젝터용(1920×1080 기준). 로그인 없이 코드로 연다.
 * 갱신: Realtime(pft_race_entries·pft_races 변경)을 "다시 읽으라는 신호"로 쓰고, 5초 폴링을 예비로 둔다.
 * 시계: 첫 응답의 server_now 로 오프셋을 재서 진행 중 참가자의 경과가 보드에서 흐른다.
 * 완주 순위가 12행을 넘으면 스크롤 대신 8초마다 페이지를 넘긴다(현장 TV는 스크롤할 수 없다).
 *
 * 시안에 없는 우리 정보(배지·중도포기·페이지 표시·참가 코드)는 같은 자리의 글자·칩으로만 얹는다(§4-1).
 * 시안에 없어 뺀 것: 종료 뒤 배지별 3열 정리 화면(완주 순위가 배지 칩으로 대신한다).
 */
const PAGE_SIZE = 12;
const PAGE_MS = 8000;
const NEW_MS = 60_000;

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

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
  // 전체화면 상태·지원 여부는 브라우저만 아는 값이라 useSyncExternalStore 로 읽는다.
  // 서버 스냅샷은 false: 아이폰 사파리처럼 지원하지 않는 곳에서는 버튼을 아예 감춘다.
  const canFull = useSyncExternalStore(subscribeFullscreen, () => document.fullscreenEnabled === true, () => false);
  const isFull = useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement != null, () => false);

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
      // 종료(pft_race_set_status)는 레이스 행만 건드린다 — 엔트리 이벤트가 오지 않으므로 따로 듣는다
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pft_races", filter: `id=eq.${raceId}` },
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

  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // 사용자 제스처가 없거나 브라우저가 거부한 경우 — 화면은 그대로 둔다
    }
  };

  const rows = rankEntries(data.entries, now);
  const running = rows.filter((r) => r.state === "running");
  const finished = rows.filter((r) => r.state === "finished");
  const closed = data.race.status === "closed";
  // 중도포기 + (종료된 레이스에서) 완주하지 못한 사람
  const isOut = (e: RaceEntry) => {
    const st = entryState(e);
    return st === "dnf" || (closed && st !== "finished");
  };
  const dnfRows = rows.filter(isOut);
  const leader = finished[0] ?? null;
  // 이미 참가한 사람에게는 코드를 다시 묻지 않는다 — 코드 대신 내 측정 화면으로 안내
  const joinedMe = meId != null && data.entries.some((e) => e.user_id === meId);
  const showCode = data.race.join_open && !closed && !joinedMe;
  const raceHref = `/pft/race/${data.race.code}`;
  // 참가 선수 패널 — 조가 배정돼 있으면 조별로 묶는다(참가 순서는 조 안에서 유지).
  // 중도포기(와 종료된 레이스의 미완주)는 조에서 빼서 맨 아래 따로 모은다.
  const entryGroups = groupByWave(data.entries.filter((e) => !isOut(e)));
  const grouped = hasWaves(data.entries);

  // 완주 순위 페이지 로테이션
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
  const stateLabel = (e: RaceEntry) => {
    const st = entryState(e);
    if (isOut(e)) return t("pft.race.dnf");
    return st === "finished"
      ? t("pft.race.finished")
      : st === "running"
        ? t("pft.race.running")
        : t("pft.race.waiting");
  };
  const stateClass = (e: RaceEntry) => {
    if (isOut(e)) return "dnf";
    const st = entryState(e);
    return st === "running" ? "timing" : st;
  };

  return (
    <div className="rx-live-board">
      <header className="rx-live-topbar">
        <Link className="rx-live-brand" href="/pft">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/roxlogy-appicon.svg" alt="" width={28} height={28} />
          ROXLOGY
        </Link>
        <div>
          <span className="rx-live-status" role="status">
            <i />
            {closed ? t("pft.race.ended").toUpperCase() : isClient && offline ? t("pft.race.offline") : "LIVE"}
          </span>
          {joinedMe && (
            <Link href={raceHref}>
              {t("pft.race.myScreen")}
            </Link>
          )}
          {canFull && (
            <Button variant="outline" onClick={toggleFull} aria-pressed={isFull}>
              {isFull ? <Minimize size={15} /> : <Maximize size={15} />}{" "}
              {t(isFull ? "pft.race.exitFullscreen" : "pft.race.fullscreen")}
            </Button>
          )}
        </div>
      </header>

      <main className="rx-live-main" id="pft-board">
        <section className="rx-live-racehead">
          <div className="rx-live-title">
            <span>
              {t("pft.race.board").toUpperCase()}
              {data.race.crew ? ` · ${data.race.crew}` : ""}
            </span>
            <h1>{data.race.title}</h1>
            <p>
              PFT · {dateLine}
              {showCode ? ` · ${t("pft.race.codeInBoard", { code: data.race.code })}` : ""}
              {" · "}
              {t(closed ? "pft.race.closed" : "pft.race.open")}
              {!data.race.join_open && !joinedMe ? ` · ${t("pft.race.staffAddedOnly")}` : ""}
            </p>
          </div>
          <div className="rx-live-stages">
            {PFT_STATIONS.map((st, i) => (
              <div key={st.key} style={{ background: PFT_COLORS[st.key] }} title={t(st.detail as DictKey) || undefined}>
                <span>
                  {i + 1}. {stationLabel(i)}
                </span>
                <strong>{t(st.amount as DictKey)}</strong>
              </div>
            ))}
          </div>
          <div className="rx-live-stats" role="status">
            {(
              [
                [t("pft.race.stats.total"), String(rows.length)],
                // 종료되면 "측정 중"이 아니라 미완주 수를 보여 준다 — 하단 명단과 같은 값이어야 한다
                [closed ? t("pft.race.dnf") : t("pft.race.stats.running"), String(closed ? dnfRows.length : running.length)],
                [t("pft.race.stats.finished"), String(finished.length)],
                [t("pft.race.stats.best"), leader?.total_ms != null ? formatMs(leader.total_ms) : "—"],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="rx-live-grid">
          {/* 참가 선수 — 조가 배정돼 있으면 조별로 묶어 보여 준다 */}
          <section className="rx-live-panel rx-live-entrants">
            <div className="rx-live-panel-head">
              <h2>{t("pft.race.athletes")}</h2>
              <b>{data.entries.length}</b>
            </div>
            {entryGroups.map((g) => (
              <div className="rx-live-wave" key={g.wave ?? "none"}>
                <h3>
                  {grouped
                    ? g.wave == null
                      ? t("pft.race.waveNone")
                      : t("pft.race.waveN", { n: g.wave })
                    : t("pft.race.waveEntrants")}
                </h3>
                {g.rows.map((e) => (
                  <div key={e.entry_id}>
                    <span className="rx-live-avatar">{initialOf(e.name)}</span>
                    <b>{e.name}</b>
                    <span className={`rx-live-state ${stateClass(e)}`}>{stateLabel(e)}</span>
                  </div>
                ))}
              </div>
            ))}
            {dnfRows.length > 0 && (
              <div className="rx-live-wave">
                <h3>{t("pft.race.dnfList")}</h3>
                {dnfRows.map((e) => (
                  <div key={e.entry_id}>
                    <span className="rx-live-avatar">{initialOf(e.name)}</span>
                    <b>{e.name}</b>
                    <span className="rx-live-state dnf">{t("pft.race.dnf")}</span>
                  </div>
                ))}
              </div>
            )}
            {!data.entries.length && (
              <p className="rx-live-empty-text">
                {showCode ? t("pft.race.joinHint", { code: data.race.code }) : t("pft.race.noEntries")}
              </p>
            )}
          </section>

          {/* 측정 중 */}
          <section className="rx-live-panel rx-live-timing">
            <div className="rx-live-panel-head">
              <h2>{t("pft.race.running")}</h2>
              <b>{closed ? 0 : running.length}</b>
              <span>{t("pft.race.segHeader")}</span>
            </div>
            {!closed && running.length ? (
              <div className="rx-live-timing-list">
                {running.map((r) => (
                  <LiveRow key={r.entry_id} r={r} stationLabel={stationLabel} />
                ))}
              </div>
            ) : (
              <div className="rx-live-empty">
                <Flag size={32} />
                <h3>{closed ? t("pft.race.closedTitle") : t("pft.race.waitNext")}</h3>
                <p>{closed ? t("pft.race.closedDesc") : t("pft.race.waitNextDesc")}</p>
              </div>
            )}
          </section>

          {/* 완주 순위 */}
          <section className="rx-live-panel rx-live-finish">
            <div className="rx-live-panel-head">
              <h2>{t("pft.race.finishRanking")}</h2>
              <b>{finished.length}</b>
              {pages > 1 && (
                <span role="status">{t("pft.race.pageOf", { page: (page % pages) + 1, total: pages })}</span>
              )}
            </div>
            <div className="rx-live-ranking-head">
              <span>{t("pft.race.rankAthlete")}</span>
              <span>{t("pft.race.colTime")}</span>
            </div>
            <ol>
              {pageRows.map((r) => {
                const gap = leader && r.total_ms != null && leader.total_ms != null ? r.total_ms - leader.total_ms : 0;
                const isMe = meId != null && r.user_id === meId;
                const isNew = isClient && !!r.finished_at && now - Date.parse(r.finished_at) < NEW_MS;
                return (
                  <li key={r.entry_id} className={r.rank === 1 ? "leader" : ""}>
                    <span className="rx-live-rank">{r.rank}</span>
                    <div>
                      <h3>
                        {r.name}
                        {isMe ? ` · ${t("pft.race.meTag")}` : ""}
                        {isNew ? ` · ${t("pft.race.newTag")}` : ""}
                      </h3>
                      <p>
                        {r.wave ? t("pft.race.waveN", { n: r.wave }) : t("pft.race.waveNone")}
                        {" · "}
                        {r.badge ? t(badgeDictKey(r.badge)) : t("pft.race.allDone")}
                        {r.scaled ? ` · ${t("pft.scaledTag")}` : ""}
                      </p>
                    </div>
                    <strong>
                      {formatMs(r.total_ms)}
                      <small>{r.rank === 1 ? t("pft.race.leader").toUpperCase() : `+${fmtClock(gap)}`}</small>
                    </strong>
                  </li>
                );
              })}
            </ol>
            {!finished.length && <p className="rx-live-empty-text">{t("pft.race.noFinished")}</p>}
            <footer>
              {t("pft.race.badgeRule", {
                gold: formatMs(PFT_CUTOFFS.under45.gold),
                silver: formatMs(PFT_CUTOFFS.under45.silver),
              })}
            </footer>
          </section>
        </div>

        <footer className="rx-live-footer">
          <span>
            {t("pft.race.liveFooter")}
            {isClient && offline ? ` · ${t("pft.race.offline")}` : ""}
          </span>
          {joinedMe ? (
            <Link href={raceHref}>
              {t("pft.race.myScreen")}
              <ArrowRight size={14} />
            </Link>
          ) : showCode ? (
            <Link href={raceHref}>
              {t("pft.race.joinCta")}
              <ArrowRight size={14} />
            </Link>
          ) : meId ? (
            <Link href="/pft">
              {t("pft.race.allResults")}
              <ArrowRight size={14} />
            </Link>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

/** 측정 중 선수 카드 — 시안 .rx-live-timing-list article 그대로: 이름·경과 / 현재 종목 / 구간 띠 */
function LiveRow({ r, stationLabel }: { r: RankedEntry; stationLabel: (i: number) => string }) {
  const { t } = useI18n();
  const cur = r.current ?? 0;
  const elapsed = r.elapsed ?? 0;
  const curElapsed = Math.max(0, elapsed - (cur === 0 ? 0 : r.splits[cur - 1]));
  return (
    <article>
      <div className="rx-live-timing-name">
        <span className="rx-live-avatar">{initialOf(r.name)}</span>
        <div>
          <h3>{r.name}</h3>
          <p>
            {r.wave ? t("pft.race.waveN", { n: r.wave }) : t("pft.race.individualStart")} ·{" "}
            {t("pft.race.stageOf", { n: cur + 1 })}
            {r.scaled ? ` · ${t("pft.scaledTag")}` : ""}
          </p>
        </div>
        <strong>{fmtClock(elapsed)}</strong>
      </div>
      <div className="rx-live-stage-now">
        <span style={{ background: PFT_COLORS[PFT_STATIONS[cur].key] }}>{stationLabel(cur)}</span>
        <b>{t(PFT_STATIONS[cur].amount as DictKey)}</b>
        <small>
          {t("pft.race.segment")} {fmtClock(curElapsed)}
          {segmentMs(r.splits, cur - 1) != null ? "" : ""}
        </small>
      </div>
      <PftSplitStrip splits={r.splits} />
    </article>
  );
}
