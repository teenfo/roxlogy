"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs, parseTimeToMs } from "@/lib/format";
import { RUN_EXERCISE_ID, STATIONS } from "@/lib/hyrox";
import { buildSearchUrl, type Season } from "@/lib/hyrox-results";
import {
  parsedFieldCount,
  parseRaceText,
  type ParsedRace,
  type RaceSegment,
} from "@/lib/race-import";
import { buildSessionRows, type SegmentForm } from "@/lib/session-builder";
import { TimeInput } from "@/components/time-input";
import { useI18n } from "@/components/i18n-provider";

const DIVISIONS = ["open", "pro", "doubles", "pro_doubles", "relay"] as const;
const SEASON_OPTIONS = [
  { value: "season-8", label: "2025/26 (S8)" },
  { value: "season-9", label: "2026/27 (S9)" },
];

type Hit = { name: string; context: string; season: string; detailUrl: string };
type Group = { value: string; label: string };

/**
 * 레이스 결과 등록 — 3단계:
 *   1. 조회 조건(공식 검색 폼과 동일: 시즌·대회·성별·성/이름)으로 검색
 *   2. 결과 목록에서 본인 선택 → 스플릿 자동 입력
 *   3. 채워진 값 확인·수정 후 저장
 * 폴백(수동 모드): 공식 사이트 새 탭 / 결과 URL / 텍스트 붙여넣기
 */
export function RaceNewForm({ eventNames }: { eventNames: string[] }) {
  const router = useRouter();
  const { t } = useI18n();

  // ── 1단계: 조회 조건 (기본 시즌 = 결과가 존재하는 최신 시즌)
  const [season, setSeason] = useState("season-8");
  const [groups, setGroups] = useState<Group[]>([]);
  const [eventGroup, setEventGroup] = useState("");
  const [divisions, setDivisions] = useState<Group[]>([]);
  const [searchDivision, setSearchDivision] = useState("");
  const [sex, setSex] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── 2단계: 결과 목록
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // ── 3단계: 저장 폼 (자동 채움 + 수동 편집)
  const [event, setEvent] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [division, setDivision] = useState<string>("open");
  const [totalText, setTotalText] = useState("");
  const [runTotalText, setRunTotalText] = useState("");
  const [stationTexts, setStationTexts] = useState<Record<string, string>>({});
  const [showManual, setShowManual] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [imported, setImported] = useState(false);
  // Race Replay 상세 (24구간) — 있으면 세션 변환 가능
  const [detail, setDetail] = useState<{
    segments: RaceSegment[];
    startClock?: string;
  } | null>(null);
  const [addSession, setAddSession] = useState(true);
  // 레이스 저장 후 세션 추가만 실패한 경우 재시도 시 레이스 중복 저장 방지
  const [savedRaceId, setSavedRaceId] = useState<string | null>(null);

  const totalMs = useMemo(() => parseTimeToMs(totalText), [totalText]);
  const canSearch = !!eventGroup && lastName.trim().length >= 2;

  // 시즌의 대회 목록 로드 (공식 검색 폼의 event_main_group 옵션)
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/races/search-meta?season=${season}`)
      .then((r) => r.json())
      .then((b) => {
        if (!cancelled) setGroups(b.groups ?? []);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  function changeSeason(next: string) {
    setSeason(next);
    setGroups([]);
    setEventGroup("");
    setDivisions([]);
    setSearchDivision("");
    setHits(null);
  }

  // 대회 선택 시 그 대회의 디비전 목록 로드
  useEffect(() => {
    if (!eventGroup) return;
    let cancelled = false;
    fetch(
      `/api/races/search-meta?season=${season}&divisionsFor=${encodeURIComponent(eventGroup)}`,
    )
      .then((r) => r.json())
      .then((b) => {
        if (!cancelled) setDivisions(b.divisions ?? []);
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventGroup, season]);

  async function handleSearch() {
    if (!canSearch) return;
    setSearchError(null);
    setImportNotice(null);
    setHits(null);
    setSearching(true);
    try {
      const res = await fetch("/api/races/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season,
          eventGroup,
          division: searchDivision || undefined,
          sex: sex || undefined,
          lastName: lastName.trim(),
          firstName: firstName.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSearchError(body.error ?? t("raceNew.import.failFetch"));
        setHits([]);
      } else {
        setHits(body.hits ?? []);
      }
    } catch {
      setSearchError(t("raceNew.import.failFetch"));
      setHits([]);
    }
    setSearching(false);
  }

  function applyParsed(parsed: ParsedRace) {
    // 검색 흐름에서는 사용자가 고른 대회가 가장 신뢰할 수 있는 이름이다
    if (eventGroup)
      setEvent(`HYROX ${eventGroup.replace(/^\d{4}\s*/, "")}`);
    else if (parsed.event) setEvent(parsed.event);
    if (parsed.eventDate) setEventDate(parsed.eventDate);
    if (parsed.division) setDivision(parsed.division);
    if (parsed.totalMs != null) setTotalText(formatMs(parsed.totalMs));
    if (parsed.runTotalMs != null) setRunTotalText(formatMs(parsed.runTotalMs));
    const st: Record<string, string> = {};
    for (const [key, ms] of Object.entries(parsed.stations))
      st[key] = formatMs(ms);
    if (Object.keys(st).length) setStationTexts((prev) => ({ ...prev, ...st }));
    setDetail(
      parsed.segments?.length
        ? { segments: parsed.segments, startClock: parsed.startClock }
        : null,
    );
    setSavedRaceId(null);
    setImported(true);
    setImportNotice(
      t("raceNew.import.parsed", { n: parsedFieldCount(parsed) }),
    );
  }

  async function importFromUrl(url: string) {
    if (!url) return;
    setImportNotice(null);
    setSaveError(null);
    setImporting(true);
    try {
      const res = await fetch("/api/races/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok) setImportNotice(body.error ?? t("raceNew.import.failFetch"));
      else applyParsed(body.parsed as ParsedRace);
    } catch {
      setImportNotice(t("raceNew.import.failFetch"));
    }
    setImporting(false);
  }

  function openOfficialSearch() {
    window.open(
      buildSearchUrl({
        season: season as Season,
        eventGroup: eventGroup || undefined,
        sex: sex === "M" || sex === "W" ? sex : undefined,
        lastName: lastName.trim(),
        firstName: firstName.trim() || undefined,
      }),
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function handleSave() {
    setSaveError(null);
    if (!event.trim()) return setSaveError(t("raceNew.errEvent"));
    if (totalMs == null) return setSaveError(t("raceNew.errTotal"));
    setPending(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setSaveError(t("common.needLogin"));
    }

    const stations: Record<string, number> = {};
    for (const s of STATIONS) {
      const ms = parseTimeToMs(stationTexts[s.key] ?? "");
      if (ms != null) stations[s.key] = ms;
    }
    const runTotalMs = parseTimeToMs(runTotalText);

    let raceId = savedRaceId;
    if (!raceId) {
      const runs = detail?.segments
        .filter((s) => s.kind === "run")
        .map((s) => s.splitMs);
      const roxzones = detail?.segments
        .filter((s) => s.kind === "roxzone")
        .map((s) => s.splitMs);
      const { data, error: err } = await supabase
        .from("race_results")
        .insert({
          user_id: user.id,
          event: event.trim(),
          event_date: eventDate || null,
          division,
          total_time_ms: totalMs,
          splits: {
            stations,
            ...(runTotalMs != null ? { run_total_ms: runTotalMs } : {}),
            ...(runs?.length ? { runs } : {}),
            ...(roxzones?.length ? { roxzones } : {}),
          },
        })
        .select("id")
        .single();
      if (err) {
        setPending(false);
        return setSaveError(t("raceNew.errSave", { msg: err.message }));
      }
      raceId = data.id;
      setSavedRaceId(data.id);
    }

    // 리플레이 24구간 → 세션으로도 추가 (워치/폰과 동일한 멱등 업서트 계약)
    if (addSession && detail) {
      const forms: SegmentForm[] = detail.segments.map((seg) => {
        const st = seg.stationKey
          ? STATIONS.find((s) => s.key === seg.stationKey)
          : null;
        return {
          kind: seg.kind,
          stationKey: seg.stationKey,
          n: seg.n,
          exerciseId:
            seg.kind === "run" ? RUN_EXERCISE_ID : (st?.exerciseId ?? null),
          machineType: st?.machineType ?? null,
          splitMs: seg.splitMs,
        };
      });
      const startLocal = new Date(
        `${eventDate || new Date().toISOString().slice(0, 10)}T${detail.startClock ?? "09:00:00"}`,
      );
      const built = buildSessionRows(
        user.id,
        Number.isNaN(startLocal.getTime())
          ? new Date().toISOString()
          : startLocal.toISOString(),
        forms,
      );
      if (!("error" in built)) {
        const { error: sErr } = await supabase
          .from("sessions")
          .upsert(built.session, { onConflict: "id" });
        const { error: gErr } = sErr
          ? { error: sErr }
          : await supabase
              .from("session_segments")
              .upsert(built.segments, { onConflict: "session_id,seq" });
        if (sErr || gErr) {
          setPending(false);
          return setSaveError(
            t("raceNew.replay.errSession", { msg: (sErr ?? gErr)!.message }),
          );
        }
      }
    }

    setPending(false);
    router.push(`/races/${raceId}`);
    router.refresh();
  }

  const inputCls =
    "rounded-md border border-muted/30 bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-accent";

  return (
    <main>
      <Link href="/races" className="text-sm text-muted hover:text-foreground">
        {t("races.back")}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t("raceNew.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("raceNew.import.desc")}</p>

      {/* ── 1단계: 조회 조건 */}
      <section className="mt-6 max-w-lg rounded-md border border-track/30 bg-surface px-4 py-4">
        <p className="text-sm font-semibold">{t("raceNew.step1")}</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.season")}
            <select
              value={season}
              onChange={(e) => changeSeason(e.target.value)}
              className={inputCls}
            >
              {SEASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.event")} *
            <select
              value={eventGroup}
              onChange={(e) => {
                setEventGroup(e.target.value);
                setDivisions([]);
                setSearchDivision("");
                setHits(null);
              }}
              className={inputCls}
            >
              <option value="">
                {groups.length ? t("raceNew.search.allEvents") : "…"}
              </option>
              {groups.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.division")}
            <select
              value={searchDivision}
              onChange={(e) => {
                setSearchDivision(e.target.value);
                setHits(null);
              }}
              disabled={!eventGroup}
              className={inputCls}
            >
              <option value="">{t("raceNew.search.allDivisions")}</option>
              {divisions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.gender")}
            <select
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              className={inputCls}
            >
              <option value="">{t("raceNew.search.any")}</option>
              <option value="M">{t("raceNew.search.male")}</option>
              <option value="W">{t("raceNew.search.female")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.lastName")} *
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.preventDefault(), handleSearch())
              }
              placeholder="Kim"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.firstName")}
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.preventDefault(), handleSearch())
              }
              placeholder="Minsu"
              className={inputCls}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || !canSearch}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
            >
              {searching
                ? t("raceNew.import.searching")
                : t("raceNew.import.searchBtn")}
            </button>
          </div>
        </div>

        {!eventGroup && (
          <p className="mt-2 text-xs text-muted">
            {t("raceNew.import.needEvent")}
          </p>
        )}
        {searchError && (
          <p className="mt-2 text-xs text-red-400">{searchError}</p>
        )}

        {/* ── 2단계: 결과 선택 */}
        {hits !== null && !searchError && (
          <div className="mt-4 border-t border-muted/20 pt-3">
            <p className="text-sm font-semibold">{t("raceNew.step2")}</p>
            {hits.length === 0 ? (
              <p className="mt-2 text-xs text-muted">
                {t("raceNew.import.noMatches")}
              </p>
            ) : (
              <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
                {hits.map((h) => (
                  <li key={h.detailUrl}>
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => importFromUrl(h.detailUrl)}
                      className="w-full rounded-md bg-background px-3 py-2 text-left hover:bg-background/60 disabled:opacity-50"
                    >
                      <span className="block text-sm">{h.name}</span>
                      {h.context && (
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {h.context}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {importing && (
              <p className="mt-1.5 text-xs text-track">
                {t("raceNew.import.loadingResult")}
              </p>
            )}
          </div>
        )}
        {importNotice && (
          <p className="mt-2 text-xs text-track">{importNotice}</p>
        )}
      </section>

      {/* ── 3단계: 확인·저장 (자동 채움 후 또는 수동 입력 열기) */}
      {imported || showManual ? (
        <section className="mt-6 max-w-lg">
          <p className="text-sm font-semibold">{t("raceNew.step3")}</p>
          <div className="mt-3 grid gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              {t("raceNew.event")}
              <input
                list="event-names"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                placeholder={t("raceNew.eventPh")}
                className={inputCls}
              />
              <datalist id="event-names">
                {eventNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>

            <div className="flex gap-4">
              <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
                {t("raceNew.date")}
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
                {t("raceNew.division")}
                <select
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                  className={inputCls}
                >
                  {DIVISIONS.map((v) => (
                    <option key={v} value={v}>
                      {t(`division.${v}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex gap-4">
              <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
                {t("raceNew.total")}
                <input
                  value={totalText}
                  onChange={(e) => setTotalText(e.target.value)}
                  placeholder="1:24:30"
                  inputMode="numeric"
                  className={`${inputCls} font-mono`}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
                {t("raceNew.runTotal")}
                <input
                  value={runTotalText}
                  onChange={(e) => setRunTotalText(e.target.value)}
                  placeholder="38:20"
                  inputMode="numeric"
                  className={`${inputCls} font-mono`}
                />
              </label>
            </div>

            <fieldset>
              <legend className="text-sm text-muted">
                {t("raceNew.stationSplits")}
              </legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {STATIONS.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center justify-between rounded-md bg-surface px-4 py-2"
                  >
                    <span className="text-sm">
                      {t(`station.${s.key}` as Parameters<typeof t>[0])}
                    </span>
                    <TimeInput
                      value={stationTexts[s.key] ?? ""}
                      onChange={(text) =>
                        setStationTexts((prev) => ({ ...prev, [s.key]: text }))
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            {/* Race Replay 상세 — 런 랩·록스존까지 인식된 경우 */}
            {detail && (
              <div className="rounded-md border border-track/30 bg-surface px-4 py-3">
                <p className="text-sm font-semibold">
                  {t("raceNew.replay.title")}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {t("raceNew.replay.desc", { n: detail.segments.length })}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                  {detail.segments
                    .filter((s) => s.kind === "run")
                    .map((s) => (
                      <span
                        key={s.n}
                        className="flex justify-between text-xs"
                      >
                        <span className="text-muted">
                          {t("newSession.runLabel", { n: s.n })}
                        </span>
                        <span className="font-mono">{formatMs(s.splitMs)}</span>
                      </span>
                    ))}
                </div>
                <p className="mt-2 flex justify-between text-xs">
                  <span className="text-muted">
                    {t("raceNew.replay.roxzoneTotal")}
                  </span>
                  <span className="font-mono">
                    {formatMs(
                      detail.segments
                        .filter((s) => s.kind === "roxzone")
                        .reduce((a, s) => a + s.splitMs, 0),
                    )}
                  </span>
                </p>
                <label className="mt-3 flex items-start gap-2 border-t border-muted/20 pt-3 text-sm">
                  <input
                    type="checkbox"
                    checked={addSession}
                    onChange={(e) => setAddSession(e.target.checked)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>
                    {t("raceNew.replay.addSession")}
                    <span className="mt-0.5 block text-xs text-muted">
                      {t("raceNew.replay.addSessionHint")}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
            <button
              onClick={handleSave}
              disabled={pending}
              className="rounded-md bg-accent px-6 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-40"
            >
              {pending
                ? t("common.saving")
                : `${t("common.save")}${totalMs != null ? ` (${formatMs(totalMs)})` : ""}`}
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="mt-4 text-sm text-track hover:underline"
        >
          {t("raceNew.manualToggle")}
        </button>
      )}

      {/* ── 폴백: 새 탭 검색 / URL / 텍스트 (수동 모드에서만 노출) */}
      {showManual && (
        <ManualImport
          onParsed={applyParsed}
          onOpenSite={openOfficialSearch}
          canOpenSite={lastName.trim().length >= 2}
          importFromUrl={importFromUrl}
          importing={importing}
        />
      )}
    </main>
  );
}

function ManualImport({
  onParsed,
  onOpenSite,
  canOpenSite,
  importFromUrl,
  importing,
}: {
  onParsed: (p: ParsedRace) => void;
  onOpenSite: () => void;
  canOpenSite: boolean;
  importFromUrl: (url: string) => void;
  importing: boolean;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  function handleText() {
    setNotice(null);
    const parsed = parseRaceText(text);
    if (parsedFieldCount(parsed) === 0) {
      setNotice(t("raceNew.import.failParse"));
      return;
    }
    onParsed(parsed);
  }

  return (
    <section className="mt-4 max-w-lg rounded-md bg-surface px-4 py-4">
      <button
        type="button"
        onClick={onOpenSite}
        disabled={!canOpenSite}
        className="text-xs text-track hover:underline disabled:opacity-40"
      >
        {t("raceNew.import.openSite")} ↗
      </button>
      <p className="mt-1 text-xs text-muted">{t("raceNew.import.steps")}</p>

      <div className="mt-3 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://results.hyrox.com/…"
          className="min-w-0 flex-1 rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => importFromUrl(url.trim())}
          disabled={importing || !url.trim()}
          className="shrink-0 rounded-md border border-muted/40 px-4 py-2 text-sm font-semibold hover:border-foreground disabled:opacity-40"
        >
          {importing
            ? t("raceNew.import.importing")
            : t("raceNew.import.button")}
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={t("raceNew.import.pastePh")}
        className="mt-3 w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-xs outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={handleText}
        disabled={!text.trim()}
        className="mt-2 rounded-md border border-muted/40 px-4 py-1.5 text-sm font-semibold hover:border-foreground disabled:opacity-40"
      >
        {t("raceNew.import.parseBtn")}
      </button>
      {notice && <p className="mt-2 text-xs text-red-400">{notice}</p>}
    </section>
  );
}
