"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const CATEGORIES = ["strength", "conditioning", "running", "mobility"] as const;
const STATIONS = Array.from({ length: 8 }, (_, i) => `station_${i + 1}`);

/** 관리자: 운동 DB 편집 (분류·스테이션 매핑·타겟 부위·별칭·설명·미디어).
 *  exercises admin RLS로 허용. */
export function AdminExerciseEditor({
  id,
  name,
  muscles,
  aliases,
  category,
  stationType,
  description,
  mediaUrl,
}: {
  id: string;
  name: string;
  muscles: string[];
  aliases: string[];
  category: string | null;
  stationType: string | null;
  description: string | null;
  mediaUrl: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(muscles.join(", "));
  const [al, setAl] = useState(aliases.join(", "));
  const [cat, setCat] = useState(category ?? "");
  const [station, setStation] = useState(stationType ?? "");
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
    const aliasesArr = al
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { error } = await supabase
      .from("exercises")
      .update({
        muscles: musclesArr.length ? musclesArr : null,
        aliases: aliasesArr,
        category: cat || null,
        station_type: station || null,
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
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-muted">
              {t("exercises.detCategory")}
              <select
                value={cat}
                onChange={(e) => {
                  setCat(e.target.value);
                  setState("idle");
                }}
                className={inputCls}
              >
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`exercises.cat.${c}` as Parameters<typeof t>[0])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1 text-xs text-muted">
              {t("exercises.detStation")}
              <select
                value={station}
                onChange={(e) => {
                  setStation(e.target.value);
                  setState("idle");
                }}
                className={inputCls}
              >
                <option value="">—</option>
                {STATIONS.map((st, i) => (
                  <option key={st} value={st}>
                    {`Station ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
            {t("admin.exAliases")} ({t("admin.commaKeys")})
            <input
              value={al}
              onChange={(e) => {
                setAl(e.target.value);
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
