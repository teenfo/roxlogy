"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent-line";

export type AttachedProgram = {
  program_id: string;
  start_date: string;
  end_date: string | null;
  repeat: boolean;
  title: string;
  level: string | null;
  weeks: number | null;
  /** 프로그램에 들어 있는 일차 수 */
  days: number;
};
export type PickableProgram = {
  id: string;
  title: string;
  level: string | null;
  weeks: number | null;
  days: number;
};

/** 날짜만 비교한다 — 시각이 끼면 하루가 어긋난다 */
const dayDiff = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );

/** 토글 — 44×26 카드형 */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-line-strong"
      }`}
    >
      <span
        className={`absolute top-[3px] h-5 w-5 rounded-full transition-[left] ${
          on ? "left-[23px] bg-background" : "left-[3px] bg-muted"
        }`}
      />
    </button>
  );
}

/**
 * 크루 훈련 일정 — 스태프가 트레이닝 프로그램을 크루에 연결한다.
 * 연결하면 프로그램 일차가 크루 일정표에 날짜별로 전개된다 (반복 규칙 준용).
 *
 * 디자인 시안(2026-09): 한 줄짜리 목록 + 가로로 늘어선 폼을 **연결 카드 목록 +
 * 우측 sticky 연결 폼**으로 나눴다. 카드는 진행 상태(예정·진행 중·종료)와 진행률을
 * 같이 보여 준다 — 예전엔 날짜 문자열만 있어서 지금 도는 프로그램이 뭔지 세어 봐야 했다.
 * Supabase 호출(업서트·삭제)은 그대로다.
 */
export function CrewProgramAttach({
  crewId,
  attached,
  programs,
  today,
}: {
  crewId: string;
  attached: AttachedProgram[];
  programs: PickableProgram[];
  /** 서버가 계산한 크루 시간대의 오늘 — UTC 로 하루 어긋나는 것 방지 */
  today: string;
}) {
  const { t, locale } = useI18n();
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
    const { error } = await supabase
      .from("crew_program_enrollments")
      .delete()
      .eq("crew_id", crewId)
      .eq("program_id", programId);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const md = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
      month: "numeric",
      day: "numeric",
    });
  /** 주 M회 — 프로그램 일차 수를 주수로 나눈다 */
  const perWeek = (p: { weeks: number | null; days: number }) =>
    p.weeks && p.weeks > 0 ? Math.round(p.days / p.weeks) : null;

  const selected = programs.find((p) => p.id === pick) ?? null;
  const already = attached.some((a) => a.program_id === pick);

  const meta = (p: PickableProgram) =>
    [p.level, p.weeks ? t("crew.progWeeks", { n: p.weeks }) : null]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-3.5">
        <div>
          <h2 className="text-lg font-extrabold">{t("crew.progAttach")}</h2>
          <p className="mt-1 text-[13px] text-muted">{t("crew.progAttachDesc")}</p>
        </div>

        {err && (
          <p role="alert" className="text-sm text-danger">
            {err}
          </p>
        )}

        {attached.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-10 text-center">
            <p className="text-[13px] text-muted-3">{t("crew.progEmpty")}</p>
          </div>
        ) : (
          attached.map((a) => {
            const started = dayDiff(today, a.start_date) >= 0;
            const ended = a.end_date != null && dayDiff(today, a.end_date) > 0;
            const state = ended ? "done" : started ? "live" : "soon";
            // 진행률은 달력 기준 — 끝날이 없으면 주수로 잡는다
            const total = a.end_date
              ? Math.max(1, dayDiff(a.end_date, a.start_date) + 1)
              : Math.max(1, (a.weeks ?? 0) * 7);
            const elapsed = Math.min(total, Math.max(0, dayDiff(today, a.start_date) + 1));
            const pct = state === "done" ? 100 : Math.round((elapsed / total) * 100);
            const pw = perWeek(a);
            return (
              <div
                key={a.program_id}
                className={`flex flex-col gap-3 rounded-[14px] border bg-card p-[18px] ${
                  state === "live" ? "border-line-accent" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                      state === "live"
                        ? "bg-accent text-accent-foreground"
                        : state === "soon"
                          ? "bg-line text-muted"
                          : "bg-line text-muted"
                    }`}
                  >
                    {t(
                      state === "live"
                        ? "crew.progLive"
                        : state === "soon"
                          ? "crew.progSoon"
                          : "crew.progDone",
                    )}
                  </span>
                  <h3 className="min-w-0 truncate text-base font-extrabold">{a.title}</h3>
                  {a.level && (
                    <span className="shrink-0 rounded bg-label-bg px-1.5 py-0.5 text-[10px] font-bold text-label">
                      {a.level}
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 gap-2">
                    <Link
                      href={`/programs/${a.program_id}`}
                      className="flex h-8 items-center rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-line-strong"
                    >
                      {t("crew.progView")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => detach(a.program_id)}
                      className="h-8 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-danger-line hover:text-danger"
                    >
                      {t("crew.progDetach")}
                    </button>
                  </span>
                </div>

                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                  <span className="tabular">
                    {md(a.start_date)}
                    {a.end_date ? ` – ${md(a.end_date)}` : ""}
                  </span>
                  {a.weeks ? <span>· {t("crew.progWeeks", { n: a.weeks })}</span> : null}
                  {pw ? <span>· {t("crew.progPerWeek", { n: pw })}</span> : null}
                  {a.repeat && <span className="text-info">· 🔁 {t("programs.repeatLabel")}</span>}
                </p>

                {state === "live" && (
                  <div className="flex flex-col gap-1.5">
                    <p className="flex items-center justify-between gap-2 text-xs text-muted-3">
                      <span>
                        {t("crew.progWeekNo", { n: Math.floor((elapsed - 1) / 7) + 1 })}
                      </span>
                      <span className="tabular">
                        {elapsed}/{total}
                      </span>
                    </p>
                    <span className="flex h-1.5 overflow-hidden rounded-full bg-line">
                      <span className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 우측 — 프로그램 연결 */}
      <form
        onSubmit={attach}
        className="flex flex-col gap-3 rounded-[14px] border border-line bg-card p-[18px] min-[900px]:sticky min-[900px]:top-5"
      >
        <p className="text-[15px] font-extrabold">{t("crew.progAttachTitle")}</p>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{t("crew.progPick")}</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={input}>
            <option value="">—</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {[p.title, meta(p)].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </label>
        <Link href="/programs" className="text-xs text-gold hover:underline">
          {t("crew.progManage")}
        </Link>

        {selected && (
          <p className="rounded-lg border border-line-accent bg-highlight px-3 py-2 text-xs text-gold">
            {t("crew.progSummary", {
              w: selected.weeks ?? 0,
              m: perWeek(selected) ?? 0,
              d: selected.days,
            })}
            {already && (
              <span className="mt-1 block text-danger">{t("crew.progAlready")}</span>
            )}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-muted">{t("programs.fldStartDate")}</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={input}
              required
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-muted">{t("programs.fldEndDate")}</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className={input}
            />
          </label>
        </div>

        <div
          className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
            repeat ? "border-line-accent bg-highlight" : "border-line bg-page"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">{t("programs.repeatLabel")}</span>
            <span className="block text-xs text-muted-3">{t("crew.progRepeatHint")}</span>
          </span>
          <Toggle on={repeat} onChange={setRepeat} label={t("programs.repeatLabel")} />
        </div>

        <button
          type="submit"
          disabled={busy || !pick || !start}
          className="h-[42px] rounded-lg bg-accent text-sm font-extrabold text-accent-foreground hover:brightness-95 disabled:bg-line-mid disabled:text-muted-3"
        >
          {busy ? t("common.saving") : t("crew.progAttachBtn")}
        </button>
      </form>
    </div>
  );
}
