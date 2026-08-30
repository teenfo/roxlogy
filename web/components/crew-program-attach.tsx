"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export type AttachedProgram = {
  program_id: string;
  start_date: string;
  end_date: string | null;
  repeat: boolean;
  title: string;
};
export type PickableProgram = { id: string; title: string };

/** 크루 훈련 일정 — 스태프가 트레이닝 프로그램을 크루에 연결한다.
 *  연결하면 프로그램 일차가 크루 일정표에 날짜별로 전개된다 (반복 규칙 준용). */
export function CrewProgramAttach({
  crewId,
  attached,
  programs,
}: {
  crewId: string;
  attached: AttachedProgram[];
  programs: PickableProgram[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (!pick || !start) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("crew_program_enrollments").upsert(
      {
        crew_id: crewId,
        program_id: pick,
        start_date: start,
        end_date: end || null,
        repeat,
        created_by: u.user?.id ?? null,
      },
      { onConflict: "crew_id,program_id" },
    );
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setPick("");
    setStart("");
    setEnd("");
    setRepeat(false);
    router.refresh();
  }

  async function detach(programId: string) {
    if (!window.confirm(t("crew.progDetachConfirm"))) return;
    const supabase = createClient();
    await supabase
      .from("crew_program_enrollments")
      .delete()
      .eq("crew_id", crewId)
      .eq("program_id", programId);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {attached.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {attached.map((a) => (
            <li
              key={a.program_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-4 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{a.title}</span>
                <span className="ml-2 text-xs text-muted">
                  {a.start_date}
                  {a.end_date ? ` ~ ${a.end_date}` : ""}
                  {a.repeat ? " 🔁" : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => detach(a.program_id)}
                className="text-xs text-muted hover:text-red-400"
              >
                {t("crew.progDetach")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={attach} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("crew.progPick")}
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${input} min-w-44`}>
            <option value="">—</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("programs.fldStartDate")}
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("programs.fldEndDate")}
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
            className={input}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
            className="accent-accent"
          />
          {t("programs.repeatLabel")}
        </label>
        <button
          type="submit"
          disabled={busy || !pick || !start}
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {t("crew.progAttachBtn")}
        </button>
      </form>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <p className="text-xs text-muted">{t("crew.progAttachDesc")}</p>
    </div>
  );
}
