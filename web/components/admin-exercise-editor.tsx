"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 관리자: 운동 DB 편집 (타겟 부위·설명·미디어). exercises admin RLS로 허용. */
export function AdminExerciseEditor({
  id,
  name,
  muscles,
  description,
  mediaUrl,
}: {
  id: string;
  name: string;
  muscles: string[];
  description: string | null;
  mediaUrl: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(muscles.join(", "));
  const [desc, setDesc] = useState(description ?? "");
  const [media, setMedia] = useState(mediaUrl ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "err">("idle");

  async function save() {
    setState("saving");
    const supabase = createClient();
    const musclesArr = m
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { error } = await supabase
      .from("exercises")
      .update({
        muscles: musclesArr.length ? musclesArr : null,
        description_ko: desc.trim() || null,
        media_url: media.trim() || null,
      })
      .eq("id", id);
    setState(error ? "err" : "saved");
  }

  const inputCls =
    "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="rounded-md bg-surface px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold">{name}</span>
        <span className="text-xs text-muted">{open ? "−" : t("admin.edit")}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-2">
          <label className="text-xs text-muted">
            {t("exercises.detTarget")} ({t("admin.commaKeys")})
            <input
              value={m}
              onChange={(e) => {
                setM(e.target.value);
                setState("idle");
              }}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-muted">
            {t("exercises.detHowTo")}
            <textarea
              value={desc}
              onChange={(e) => {
                setDesc(e.target.value);
                setState("idle");
              }}
              rows={3}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-muted">
            {t("admin.mediaUrl")}
            <input
              value={media}
              onChange={(e) => {
                setMedia(e.target.value);
                setState("idle");
              }}
              className={inputCls}
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={state === "saving"}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
            >
              {state === "saving" ? t("common.saving") : t("common.save")}
            </button>
            {state === "saved" && (
              <span className="text-xs text-track">{t("profile.saved")}</span>
            )}
            {state === "err" && (
              <span className="text-xs text-red-400">{t("common.needLogin")}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
