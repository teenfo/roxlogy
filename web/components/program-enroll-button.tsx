"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 로컬 기준 오늘 날짜 (YYYY-MM-DD) */
function todayLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD + n일 */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/** 프로그램 시작 — 템플릿을 "내 일정"으로 바인딩한다.
 *  모달에서 시작일(기본 오늘)과 "설정 기간 동안 반복" 여부를 정한다.
 *  비반복: 종료 = 시작 + 일차 수 − 1 (자동)
 *  반복: 종료일 선택(비우면 중지할 때까지 무기한 순환) */
export function ProgramEnrollButton({
  programId,
  initialActive,
  totalDays,
}: {
  programId: string;
  initialActive: boolean;
  totalDays: number; // max day_index (프로그램 길이)
}) {
  const router = useRouter();
  const { t, tag } = useI18n();
  const [active, setActive] = useState(initialActive);
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(todayLocal());
  const [repeat, setRepeat] = useState(false);
  const [repeatEnd, setRepeatEnd] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const endPreview = repeat
    ? repeatEnd || null
    : totalDays > 0
      ? addDays(startDate, totalDays - 1)
      : null;
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(tag, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });

  async function start() {
    setPending(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setErr(t("common.needLogin"));
    }
    // 활성 등록은 1건 — 기존 활성을 해제한 뒤 새로 시작한다.
    // 두 단계가 원자적이지 않으므로, 삽입이 실패하면 해제한 등록을
    // 되돌려 사용자가 진행 중인 프로그램을 잃지 않게 한다.
    const { data: prevActive } = await supabase
      .from("program_enrollments")
      .select("id")
      .eq("user_id", user.id)
      .eq("active", true);
    const prevIds = (prevActive ?? []).map((r) => r.id as string);
    if (prevIds.length) {
      const { error: offErr } = await supabase
        .from("program_enrollments")
        .update({ active: false })
        .in("id", prevIds);
      if (offErr) {
        setPending(false);
        return setErr(offErr.message);
      }
    }
    const { error } = await supabase.from("program_enrollments").insert({
      user_id: user.id,
      program_id: programId,
      start_date: startDate,
      repeat,
      end_date: repeat ? repeatEnd || null : null,
      active: true,
    });
    if (error) {
      if (prevIds.length) {
        await supabase
          .from("program_enrollments")
          .update({ active: true })
          .in("id", prevIds);
      }
      setPending(false);
      return setErr(error.message);
    }
    setPending(false);
    setActive(true);
    setOpen(false);
    router.refresh();
  }

  async function stop() {
    setPending(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setErr(t("common.needLogin"));
    }
    const { error } = await supabase
      .from("program_enrollments")
      .update({ active: false })
      .eq("user_id", user.id)
      .eq("program_id", programId)
      .eq("active", true);
    setPending(false);
    if (error) return setErr(error.message);
    setActive(false);
    router.refresh();
  }

  if (active) {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-track/15 px-3 py-1 text-xs font-semibold text-track">
            {t("programs.enrolled")}
          </span>
          <button
            onClick={stop}
            disabled={pending}
            className="text-xs text-muted hover:text-foreground disabled:opacity-40"
          >
            {t("programs.stop")}
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => {
          setStartDate(todayLocal());
          setRepeat(false);
          setRepeatEnd("");
          setErr(null);
          setOpen(true);
        }}
        className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
      >
        {t("programs.start")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">{t("programs.enrollTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("programs.enrollDesc")}</p>

            <label className="mt-4 flex flex-col gap-1.5 text-sm text-muted">
              {t("programs.fldStartDate")}
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
              />
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
                className="accent-accent"
              />
              {t("programs.repeatLabel")}
            </label>

            {repeat && (
              <label className="mt-2 flex flex-col gap-1.5 text-sm text-muted">
                {t("programs.enrollRepeatEnd")}
                <input
                  type="date"
                  value={repeatEnd}
                  min={startDate || undefined}
                  onChange={(e) => setRepeatEnd(e.target.value)}
                  className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
                />
              </label>
            )}

            <p className="mt-3 rounded-md bg-surface px-3 py-2.5 text-sm">
              {repeat && !endPreview ? (
                <span className="text-muted">
                  🔁 {t("programs.enrollRepeatNote")}
                </span>
              ) : endPreview ? (
                <>
                  <span className="text-muted">
                    {t("programs.enrollEndPreview")}
                  </span>{" "}
                  <b className="text-track">{fmt(endPreview)}</b>
                  {!repeat && (
                    <span className="ml-1 text-xs text-muted">
                      ({t("programs.dayN", { n: totalDays })})
                    </span>
                  )}
                  {repeat && <span className="ml-1">🔁</span>}
                </>
              ) : (
                <span className="text-muted">{t("programs.emptyDays")}</span>
              )}
            </p>

            {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-4 py-2 text-sm text-muted hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={start}
                disabled={pending || !startDate}
                className="rounded-md bg-accent px-5 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
              >
                {pending ? t("common.saving") : t("programs.start")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
