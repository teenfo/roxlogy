"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Chip, Choice, Empty, Field, Go, Hint, Panel, ProgressBar } from "@/components/rox/ui";

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
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * 크루 훈련 일정 — 시안 crew.tsx Manage(훈련 연결) 그대로 (PORT_PLAN §3-e):
 * .rx-form-layout[ Panel 연결된 프로그램(우리 목록) | aside Panel "크루 훈련 프로그램"(Field 연결할 프로그램 Choice ·
 * Hint · 버튼) ]. 시작·종료·반복은 우리 입력이라 Field·.rx-switch-row 로 더한다(§4).
 * 연결하면 프로그램 일차가 크루 일정표에 날짜별로 전개된다 (반복 규칙 준용).
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
  const [pick, setPick] = useState("none");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (pick === "none" || !start) return;
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
    if (error) return setErr(error.message);
    setPick("none");
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

  const md = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  /** 주 M회 — 프로그램 일차 수를 주수로 나눈다 */
  const perWeek = (p: { weeks: number | null; days: number }) => (p.weeks && p.weeks > 0 ? Math.round(p.days / p.weeks) : null);
  const selected = programs.find((p) => p.id === pick) ?? null;
  const already = attached.some((a) => a.program_id === pick);
  const meta = (p: PickableProgram) => [p.level, p.weeks ? t("crew.progWeeks", { n: p.weeks }) : null].filter(Boolean).join(" · ");

  return (
    <div className="rx-form-layout">
      <Panel title={t("crew.progAttach")}>
        <p>{t("crew.progAttachDesc")}</p>
        {err && (
          <p role="alert" className="rx-error">
            {err}
          </p>
        )}
        {attached.length === 0 ? (
          <Empty title={t("crew.progEmpty")} description={t("crew.progAttachDesc")} />
        ) : (
          attached.map((a) => {
            const started = dayDiff(today, a.start_date) >= 0;
            const ended = a.end_date != null && dayDiff(today, a.end_date) > 0;
            const state = ended ? "done" : started ? "live" : "soon";
            const total = a.end_date ? Math.max(1, dayDiff(a.end_date, a.start_date) + 1) : Math.max(1, (a.weeks ?? 0) * 7);
            const elapsed = Math.min(total, Math.max(0, dayDiff(today, a.start_date) + 1));
            const pct = state === "done" ? 100 : Math.round((elapsed / total) * 100);
            const pw = perWeek(a);
            return (
              <div key={a.program_id} className="rx-goal-card rx-panel" style={{ marginTop: 16 }}>
                <div className="rx-actions">
                  <Chip tone={state === "live" ? "yellow" : "neutral"}>
                    {t(state === "live" ? "crew.progLive" : state === "soon" ? "crew.progSoon" : "crew.progDone")}
                  </Chip>
                  {a.level && <Chip>{a.level}</Chip>}
                  {a.repeat && <Chip tone="blue">{t("programs.repeatLabel")}</Chip>}
                </div>
                <h3 style={{ marginTop: 12 }}>{a.title}</h3>
                <p>
                  {md(a.start_date)}
                  {a.end_date ? ` – ${md(a.end_date)}` : ""}
                  {a.weeks ? ` · ${t("crew.progWeeks", { n: a.weeks })}` : ""}
                  {pw ? ` · ${t("crew.progPerWeek", { n: pw })}` : ""}
                </p>
                {state === "live" && (
                  <>
                    <Hint>
                      {t("crew.progWeekNo", { n: Math.floor((elapsed - 1) / 7) + 1 })} · {elapsed}/{total}
                    </Hint>
                    <ProgressBar value={pct} label={a.title} />
                  </>
                )}
                <div className="rx-actions" style={{ marginTop: 16 }}>
                  <Go href={`/programs/${a.program_id}`}>{t("crew.progView")}</Go>
                  <Button variant="outline" type="button" className="rx-pft-close" onClick={() => detach(a.program_id)}>
                    {t("crew.progDetach")}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <aside>
        <form onSubmit={attach}>
          <Panel title={t("crew.progAttachTitle")}>
            <Field label={t("crew.attendedProgram")}>
              <Choice
                label={t("crew.progPick")}
                value={pick}
                onChange={setPick}
                options={[["none", "—"], ...programs.map((p) => [p.id, [p.title, meta(p)].filter(Boolean).join(" · ")] as [string, string])]}
              />
            </Field>
            {selected && (
              <Hint>
                {t("crew.progSummary", { w: selected.weeks ?? 0, m: perWeek(selected) ?? 0, d: selected.days })}
                {already && ` · ${t("crew.progAlready")}`}
              </Hint>
            )}
            <div className="rx-form-grid">
              <Field label={t("programs.fldStartDate")}>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
              </Field>
              <Field label={t("programs.fldEndDate")}>
                <Input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            <label className="rx-switch-row">
              <span>
                <b>{t("programs.repeatLabel")}</b>
                <small>{t("crew.progRepeatHint")}</small>
              </span>
              <Switch checked={repeat} onCheckedChange={setRepeat} />
            </label>
            <Button type="submit" className="rx-primary rx-wide" disabled={busy || pick === "none" || !start}>
              {busy ? t("common.saving") : t("crew.progAttachBtn")}
            </Button>
            <Hint>
              <Link href="/programs">{t("crew.progManage")}</Link>
            </Hint>
          </Panel>
        </form>
      </aside>
    </div>
  );
}
