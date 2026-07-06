"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs, parseTimeToMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import {
  parsedFieldCount,
  parseRaceText,
  type ParsedRace,
} from "@/lib/race-import";
import { buildSearchUrl, type Season } from "@/lib/hyrox-results";
import { TimeInput } from "@/components/time-input";
import { useI18n } from "@/components/i18n-provider";

const DIVISIONS = ["open", "pro", "doubles", "pro_doubles", "relay"] as const;

export function RaceNewForm({ eventNames }: { eventNames: string[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const [event, setEvent] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [division, setDivision] = useState<string>("open");
  const [totalText, setTotalText] = useState("");
  const [runTotalText, setRunTotalText] = useState("");
  const [stationTexts, setStationTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [season, setSeason] = useState("season-9");
  const [eventGroup, setEventGroup] = useState("");
  const [groups, setGroups] = useState<{ value: string; label: string }[]>([]);
  const [sex, setSex] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<
    { name: string; context: string; season: string; detailUrl: string }[] | null
  >(null);

  const totalMs = useMemo(() => parseTimeToMs(totalText), [totalText]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/races/search-meta?season=${season}`)
      .then((r) => r.json())
      .then((b) => {
        if (!cancelled) setGroups(b.groups ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [season]);

  function changeSeason(next: string) {
    setSeason(next);
    setGroups([]);
    setEventGroup("");
  }

  function applyParsed(parsed: ParsedRace) {
    if (parsed.event) setEvent(parsed.event);
    if (parsed.eventDate) setEventDate(parsed.eventDate);
    if (parsed.division) setDivision(parsed.division);
    if (parsed.totalMs != null) setTotalText(formatMs(parsed.totalMs));
    if (parsed.runTotalMs != null) setRunTotalText(formatMs(parsed.runTotalMs));
    const st: Record<string, string> = {};
    for (const [key, ms] of Object.entries(parsed.stations))
      st[key] = formatMs(ms);
    if (Object.keys(st).length)
      setStationTexts((prev) => ({ ...prev, ...st }));
    setImportNotice(
      t("raceNew.import.parsed", { n: parsedFieldCount(parsed) }),
    );
  }

  async function importFromUrl(url: string) {
    setImportNotice(null);
    setError(null);
    setImporting(true);
    try {
      const res = await fetch("/api/races/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok) {
        setImportNotice(body.error ?? t("raceNew.import.failFetch"));
        if (res.status === 400 || res.status === 422) setShowPaste(true);
      } else {
        applyParsed(body.parsed as ParsedRace);
      }
    } catch {
      setImportNotice(t("raceNew.import.failFetch"));
      setShowPaste(true);
    }
    setImporting(false);
  }

  async function handleSearch() {
    if (lastName.trim().length < 2 || !eventGroup) return;
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
          sex: sex || undefined,
          lastName: lastName.trim(),
          firstName: firstName.trim() || undefined,
        }),
      });
      const body = await res.json();
      setHits(res.ok ? (body.hits ?? []) : []);
    } catch {
      setHits([]);
    }
    setSearching(false);
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

  function handleTextImport() {
    setImportNotice(null);
    const parsed = parseRaceText(importText);
    if (parsedFieldCount(parsed) === 0) {
      setImportNotice(t("raceNew.import.failParse"));
      return;
    }
    applyParsed(parsed);
  }

  async function handleSave() {
    setError(null);
    if (!event.trim()) return setError(t("raceNew.errEvent"));
    if (totalMs == null) return setError(t("raceNew.errTotal"));
    setPending(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }

    const stations: Record<string, number> = {};
    for (const s of STATIONS) {
      const ms = parseTimeToMs(stationTexts[s.key] ?? "");
      if (ms != null) stations[s.key] = ms;
    }
    const runTotalMs = parseTimeToMs(runTotalText);

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
        },
      })
      .select("id")
      .single();

    setPending(false);
    if (err) return setError(t("raceNew.errSave", { msg: err.message }));
    router.push(`/races/${data.id}`);
    router.refresh();
  }

  return (
    <main>
      <Link href="/races" className="text-sm text-muted hover:text-foreground">
        {t("races.back")}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t("raceNew.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("raceNew.desc")}</p>

      <section className="mt-6 max-w-lg rounded-md border border-track/30 bg-surface px-4 py-4">
        <p className="text-sm font-semibold">{t("raceNew.import.title")}</p>
        <p className="mt-1 text-xs text-muted">{t("raceNew.import.desc")}</p>

        {/* 1차: 공식 검색 폼과 동일한 조건 검색 */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.season")}
            <select
              value={season}
              onChange={(e) => changeSeason(e.target.value)}
              className="rounded-md border border-muted/30 bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="season-9">2026/27 (S9)</option>
              <option value="season-8">2025/26 (S8)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.event")}
            <select
              value={eventGroup}
              onChange={(e) => setEventGroup(e.target.value)}
              className="rounded-md border border-muted/30 bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="">{t("raceNew.search.allEvents")}</option>
              {groups.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.gender")}
            <select
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              className="rounded-md border border-muted/30 bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="">{t("raceNew.search.any")}</option>
              <option value="M">{t("raceNew.search.male")}</option>
              <option value="W">{t("raceNew.search.female")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("raceNew.search.lastName")}
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.preventDefault(), handleSearch())
              }
              placeholder="Hong"
              className="rounded-md border border-muted/30 bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-accent"
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
              placeholder="Gildong"
              className="rounded-md border border-muted/30 bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || lastName.trim().length < 2 || !eventGroup}
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

        {hits !== null &&
          (hits.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              {t("raceNew.import.noMatches")}
            </p>
          ) : (
            <div className="mt-3">
              <p className="text-xs text-muted">
                {t("raceNew.import.pickResult")}
              </p>
              <ul className="mt-1.5 flex max-h-64 flex-col gap-1 overflow-y-auto">
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
              {importing && (
                <p className="mt-1.5 text-xs text-track">
                  {t("raceNew.import.loadingResult")}
                </p>
              )}
            </div>
          ))}

        <button
          type="button"
          onClick={openOfficialSearch}
          disabled={lastName.trim().length < 2}
          className="mt-3 text-xs text-track hover:underline disabled:opacity-40"
        >
          {t("raceNew.import.openSite")} ↗
        </button>
        <p className="mt-1 text-xs text-muted">{t("raceNew.import.steps")}</p>

        {/* 돌아와서: 결과 페이지 URL 붙여넣기 */}
        {(
          <div className="mt-2 flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://results.hyrox.com/…"
              className="min-w-0 flex-1 rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => importFromUrl(importUrl.trim())}
              disabled={importing || !importUrl.trim()}
              className="shrink-0 rounded-md border border-muted/40 px-4 py-2 text-sm font-semibold hover:border-foreground disabled:opacity-40"
            >
              {importing
                ? t("raceNew.import.importing")
                : t("raceNew.import.button")}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="mt-3 text-xs text-track hover:underline"
        >
          {showPaste
            ? t("raceNew.import.pasteClose")
            : t("raceNew.import.pasteOpen")}
        </button>
        {showPaste && (
          <div className="mt-2">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              placeholder={t("raceNew.import.pastePh")}
              className="w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-xs outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleTextImport}
              disabled={!importText.trim()}
              className="mt-2 rounded-md border border-muted/40 px-4 py-1.5 text-sm font-semibold hover:border-foreground disabled:opacity-40"
            >
              {t("raceNew.import.parseBtn")}
            </button>
          </div>
        )}
        {importNotice && (
          <p className="mt-2 text-xs text-track">{importNotice}</p>
        )}
      </section>

      <div className="mt-6 grid max-w-lg gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("raceNew.event")}
          <input
            list="event-names"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            placeholder={t("raceNew.eventPh")}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
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
              className="rounded-md border border-muted/30 bg-surface px-3 py-2 text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("raceNew.division")}
            <select
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
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
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 font-mono text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("raceNew.runTotal")}
            <input
              value={runTotalText}
              onChange={(e) => setRunTotalText(e.target.value)}
              placeholder="38:20"
              inputMode="numeric"
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 font-mono text-foreground outline-none focus:border-accent"
            />
          </label>
        </div>

        <fieldset className="mt-2">
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

        {error && <p className="text-sm text-red-400">{error}</p>}
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
    </main>
  );
}
