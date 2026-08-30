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
 *  모달에서 시작일을 고르면(기본 오늘) 종료 예정일이 함께 표시된다.
 *  비반복: 종료 = 시작 + 일차 수 − 1 / 반복: 중지할 때까지 순환. */
export function ProgramEnrollButton({
  programId,
  initialActive,
  totalDays,
  repeat,
}: {
  programId: string;
  initialActive: boolean;
  totalDays: number; // max day_index (프로그램 길이)
  repeat: boolean;
}) {
  const router = useRouter();
  const { t, tag } = useI18n();
  const [active, setActive] = useState(initialActive);
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(todayLocal());
  const [pending, setPending] = useState(false);

  const endPreview =
    !repeat && totalDays > 0 ? addDays(startDate, totalDays - 1) : null;
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(tag, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });

  async function start() {
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return;
    }
    // 활성 등록은 1건 — 기존 활성 해제 후 새로 시작
    await supabase
      .from("program_enrollments")
      .update({ active: false })
      .eq("user_id", user.id)
      .eq("active", true);
    const { error } = await supabase.from("program_enrollments").insert({
      user_id: user.id,
      program_id: programId,
      start_date: startDate,
      active: true,
    });
    setPending(false);
    if (!error) {
      setActive(true);
      setOpen(false);
      router.refresh();
    }
  }

  async function stop() {
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return;
    }
    await supabase
      .from("program_enrollments")
      .update({ active: false })
      .eq("user_id", user.id)
      .eq("program_id", programId)
      .eq("active", true);
    setPending(false);
    setActive(false);
    router.refresh();
  }

  if (active) {
    return (
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
    );
  }

  return (
    <>
      <button
        onClick={() => {
          setStartDate(todayLocal());
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
            <p className="mt-1 text-xs text-muted">
              {t("programs.enrollDesc")}
            </p>

            <label className="mt-4 flex flex-col gap-1.5 text-sm text-muted">
              {t("programs.fldStartDate")}
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
              />
            </label>

            <p className="mt-3 rounded-md bg-surface px-3 py-2.5 text-sm">
              {repeat ? (
                <span className="text-muted">
                  🔁 {t("programs.enrollRepeatNote")}
                </span>
              ) : endPreview ? (
                <>
                  <span className="text-muted">
                    {t("programs.enrollEndPreview")}
                  </span>{" "}
                  <b className="text-track">{fmt(endPreview)}</b>
                  <span className="ml-1 text-xs text-muted">
                    ({t("programs.dayN", { n: totalDays })})
                  </span>
                </>
              ) : (
                <span className="text-muted">{t("programs.emptyDays")}</span>
              )}
            </p>

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
