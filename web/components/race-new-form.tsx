"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs, parseTimeToMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import {
  parsedFieldCount,
  parseRaceText,
  type ParsedRace,
} from "@/lib/race-import";
import { TimeInput } from "@/components/time-input";

const DIVISIONS = [
  ["open", "오픈"],
  ["pro", "프로"],
  ["doubles", "더블"],
  ["pro_doubles", "프로 더블"],
  ["relay", "릴레이"],
] as const;

export function RaceNewForm({ eventNames }: { eventNames: string[] }) {
  const router = useRouter();
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

  const totalMs = useMemo(() => parseTimeToMs(totalText), [totalText]);

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
      `${parsedFieldCount(parsed)}개 항목을 인식해 채웠습니다. 값을 확인한 뒤 저장하세요.`,
    );
  }

  async function handleUrlImport() {
    setImportNotice(null);
    setError(null);
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const res = await fetch("/api/races/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setImportNotice(body.error ?? "가져오기에 실패했습니다.");
        if (res.status === 400 || res.status === 422) setShowPaste(true);
      } else {
        applyParsed(body.parsed as ParsedRace);
      }
    } catch {
      setImportNotice("가져오기에 실패했습니다. 텍스트 붙여넣기를 이용해 보세요.");
      setShowPaste(true);
    }
    setImporting(false);
  }

  function handleTextImport() {
    setImportNotice(null);
    const parsed = parseRaceText(importText);
    if (parsedFieldCount(parsed) === 0) {
      setImportNotice(
        "붙여넣은 텍스트에서 기록을 인식하지 못했습니다. 스테이션 이름과 시간이 포함된 결과 화면 전체를 복사해 주세요.",
      );
      return;
    }
    applyParsed(parsed);
  }

  async function handleSave() {
    setError(null);
    if (!event.trim()) return setError("대회명을 입력해 주세요.");
    if (totalMs == null) return setError("총 기록을 mm:ss 또는 h:mm:ss로 입력해 주세요.");
    setPending(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError("로그인이 필요합니다.");
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
    if (err) return setError(`저장 실패: ${err.message}`);
    router.push(`/races/${data.id}`);
    router.refresh();
  }

  return (
    <main>
      <Link href="/races" className="text-sm text-muted hover:text-foreground">
        ← 레이스
      </Link>
      <h1 className="mt-4 text-2xl font-bold">공식 레이스 결과 등록</h1>
      <p className="mt-1 text-sm text-muted">
        공식 결과 페이지에서 본인 기록을 확인한 뒤 그대로 옮겨 적으세요.
      </p>

      <section className="mt-6 max-w-lg rounded-md border border-track/30 bg-surface px-4 py-4">
        <p className="text-sm font-semibold">내 결과 자동 가져오기</p>
        <p className="mt-1 text-xs text-muted">
          공식 결과 사이트(results.hyrox.com 등)의 <b>본인 결과 페이지 주소</b>를
          붙여넣으면 기록을 자동으로 채웁니다.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://results.hyrox.com/…"
            className="min-w-0 flex-1 rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={handleUrlImport}
            disabled={importing || !importUrl.trim()}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
          >
            {importing ? "가져오는 중…" : "가져오기"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="mt-3 text-xs text-track hover:underline"
        >
          {showPaste ? "텍스트 붙여넣기 닫기" : "주소가 안 되나요? 결과 텍스트 붙여넣기"}
        </button>
        {showPaste && (
          <div className="mt-2">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              placeholder="결과 페이지에서 기록 부분을 전체 선택·복사해 여기에 붙여넣으세요 (스테이션 이름 + 시간이 포함되면 인식됩니다)"
              className="w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-xs outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleTextImport}
              disabled={!importText.trim()}
              className="mt-2 rounded-md border border-muted/40 px-4 py-1.5 text-sm font-semibold hover:border-foreground disabled:opacity-40"
            >
              텍스트에서 인식
            </button>
          </div>
        )}
        {importNotice && (
          <p className="mt-2 text-xs text-track">{importNotice}</p>
        )}
      </section>

      <div className="mt-6 grid max-w-lg gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          대회
          <input
            list="event-names"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            placeholder="예: HYROX Seoul"
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
            대회 날짜
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2 text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            디비전
            <select
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            >
              {DIVISIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            총 기록 (h:mm:ss)
            <input
              value={totalText}
              onChange={(e) => setTotalText(e.target.value)}
              placeholder="1:24:30"
              inputMode="numeric"
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 font-mono text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            런 합계 (선택)
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
          <legend className="text-sm text-muted">스테이션 스플릿 (선택)</legend>
          <div className="mt-2 flex flex-col gap-1.5">
            {STATIONS.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between rounded-md bg-surface px-4 py-2"
              >
                <span className="text-sm">{s.nameKo}</span>
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
          {pending ? "저장 중…" : `저장${totalMs != null ? ` (${formatMs(totalMs)})` : ""}`}
        </button>
      </div>
    </main>
  );
}
