"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs, KIND_LABEL } from "@/lib/format";
import {
  buildSessionRows,
  raceSimTemplate,
  type SegmentForm,
} from "@/lib/session-builder";
import { TimeInput } from "@/components/time-input";

const KIND_BADGE: Record<string, string> = {
  run: "border-track/60 text-track",
  station: "border-accent/60 text-accent",
  roxzone: "border-muted/60 text-muted",
};

type Row = SegmentForm & { text: string };

export function SessionNewForm() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    raceSimTemplate().map((s) => ({ ...s, text: "" })),
  );
  const [startedAt, setStartedAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const totalMs = useMemo(
    () => rows.reduce((acc, r) => acc + (r.splitMs ?? 0), 0),
    [rows],
  );

  function update(idx: number, text: string, ms: number | null) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, text, splitMs: ms } : r)),
    );
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError("로그인이 필요합니다.");
    }

    const built = buildSessionRows(
      user.id,
      new Date(startedAt).toISOString(),
      rows,
    );
    if ("error" in built) {
      setPending(false);
      return setError(built.error);
    }

    // 멱등 업서트 — 워치/폰과 동일 계약 (003 충돌 키)
    const { error: sErr } = await supabase
      .from("sessions")
      .upsert(built.session, { onConflict: "id" });
    if (sErr) {
      setPending(false);
      return setError(`세션 저장 실패: ${sErr.message}`);
    }
    const { error: gErr } = await supabase
      .from("session_segments")
      .upsert(built.segments, { onConflict: "session_id,seq" });
    if (gErr) {
      setPending(false);
      return setError(`세그먼트 저장 실패: ${gErr.message}`);
    }

    router.push(`/sessions/${built.session.id}`);
    router.refresh();
  }

  return (
    <main>
      <Link href="/sessions" className="text-sm text-muted hover:text-foreground">
        ← 세션 히스토리
      </Link>
      <h1 className="mt-4 text-2xl font-bold">세션 기록 입력</h1>
      <p className="mt-1 text-sm text-muted">
        레이스 시뮬 결과를 수동으로 기록합니다. 기록한 세그먼트만 저장되며,
        워치 앱 출시 후에는 자동으로 동기화됩니다.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <label className="text-sm text-muted">시작 시각</label>
        <input
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
          className="rounded-md border border-muted/30 bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <ol className="mt-6 flex flex-col gap-1.5">
        {rows.map((row, idx) => (
          <li
            key={idx}
            className="flex items-center gap-3 rounded-md bg-surface px-4 py-2"
          >
            <span className="w-6 text-right font-mono text-xs text-muted">
              {idx + 1}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-xs ${KIND_BADGE[row.kind]}`}
            >
              {KIND_LABEL[row.kind]}
            </span>
            <span className="flex-1 text-sm">{row.label}</span>
            <TimeInput
              value={row.text}
              onChange={(text, ms) => update(idx, text, ms)}
            />
          </li>
        ))}
      </ol>

      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-4 border-t border-surface bg-background py-4">
        <p className="text-sm text-muted">
          합계{" "}
          <span className="font-mono text-lg font-semibold text-foreground">
            {formatMs(totalMs)}
          </span>
        </p>
        <div className="flex items-center gap-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={handleSave}
            disabled={pending || totalMs === 0}
            className="rounded-md bg-accent px-6 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-40"
          >
            {pending ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </main>
  );
}
