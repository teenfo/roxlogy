"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs, parseTimeToMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
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

  const totalMs = useMemo(() => parseTimeToMs(totalText), [totalText]);

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
