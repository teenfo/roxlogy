"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 소유자용: 프로그램 시작·종료일·반복 편집. 저장 시 각 일차 날짜가 갱신된다. */
export function ProgramDatesEditor({
  programId,
  initialStart,
  initialEnd,
  initialRepeat = false,
}: {
  programId: string;
  initialStart: string | null;
  initialEnd: string | null;
  initialRepeat?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [start, setStart] = useState(initialStart ?? "");
  const [end, setEnd] = useState(initialEnd ?? "");
  const [repeat, setRepeat] = useState(initialRepeat);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const dirty =
    start !== (initialStart ?? "") ||
    end !== (initialEnd ?? "") ||
    repeat !== initialRepeat;

  async function save() {
    setPending(true);
    setSaved(false);
    const supabase = createClient();
    const { error } = await supabase
      .from("programs")
      .update({
        start_date: start || null,
        end_date: end || null,
        repeat_enabled: repeat,
      })
      .eq("id", programId);
    setPending(false);
    if (!error) {
      setSaved(true);
      router.refresh();
    }
  }

  const inputCls =
    "rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md bg-surface px-4 py-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("programs.fldStartDate")}
        <input
          type="date"
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            setSaved(false);
          }}
          className={inputCls}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("programs.fldEndDate")}
        <input
          type="date"
          value={end}
          min={start || undefined}
          onChange={(e) => {
            setEnd(e.target.value);
            setSaved(false);
          }}
          className={inputCls}
        />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input
          type="checkbox"
          checked={repeat}
          onChange={(e) => {
            setRepeat(e.target.checked);
            setSaved(false);
          }}
        />
        {t("programs.repeatLabel")}
      </label>
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty}
        className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
      >
        {pending ? t("common.saving") : t("common.save")}
      </button>
      {saved && !dirty && (
        <span className="text-xs text-track">{t("profile.saved")}</span>
      )}
      {repeat && (
        <p className="w-full text-xs text-muted">{t("programs.repeatHint")}</p>
      )}
    </div>
  );
}
