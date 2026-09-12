"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Dialog } from "@/components/ui/dialog";

const LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;

/** 프로그램 기본 정보(제목·설명·기간·레벨·공개) 수정 — 소유자만.
 *  일자 구성은 빌더에서 하고, 여기는 프로그램 자체의 속성만 다룬다. */
export function ProgramBasicsEditor({
  programId,
  title: title0,
  description: desc0,
  weeks: weeks0,
  level: level0,
  isPublic: pub0,
}: {
  programId: string;
  title: string;
  description: string | null;
  weeks: number | null;
  level: string | null;
  isPublic: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(title0);
  const [description, setDescription] = useState(desc0 ?? "");
  const [weeks, setWeeks] = useState(weeks0 ? String(weeks0) : "");
  const [level, setLevel] = useState(level0 ?? "intermediate");
  const [isPublic, setIsPublic] = useState(pub0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErr(t("programs.errTitle"));
    setBusy(true);
    setErr(null);
    const { error } = await createClient()
      .from("programs")
      .update({
        title: title.trim(),
        description: description.trim() || null,
        weeks: weeks ? Number(weeks) : null,
        level,
        is_public: isPublic,
      })
      .eq("id", programId);
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  const field =
    "rounded-lg border border-line-strong bg-page px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-muted-2 hover:text-foreground"
      >
        {t("programs.editBasics")}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={t("programs.editBasics")}
        closeLabel={t("common.cancel")}
        panelClassName="max-w-lg"
      >
        {open && (
          <form
            onSubmit={save}
            className="flex w-full flex-col gap-3 rounded-[14px] border border-line bg-card p-5 text-left"
          >
            <p className="text-sm font-bold">{t("programs.editBasics")}</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              className={`${field} font-semibold`}
              placeholder={t("programs.titlePh")}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={400}
              className={`${field} resize-y`}
              placeholder={t("programs.descPh")}
            />
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t("programs.fldWeeks")}
                <input
                  value={weeks}
                  onChange={(e) => setWeeks(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  className={`${field} tabular w-24`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t("programs.fldLevel")}
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className={field}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {t(`predict.level.${l}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="accent-accent"
              />
              {t("programs.fldPublic")}
            </label>
            {err && <p role="alert" className="text-xs text-danger">{err}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex h-9 items-center rounded-lg bg-accent px-4 text-[13px] font-extrabold text-background disabled:opacity-40"
              >
                {busy ? t("common.saving") : t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 items-center px-3 text-[13px] text-muted hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
