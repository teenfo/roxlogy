"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Choice, Field, Hint } from "@/components/rox/ui";

const CATEGORIES = ["strength", "conditioning", "running", "mobility"] as const;
const STATIONS = Array.from({ length: 8 }, (_, i) => `station_${i + 1}`);

/** 관리자: 운동 DB 편집 (분류·스테이션 매핑·타겟 부위·별칭·설명·미디어).
 *  exercises admin RLS로 허용. 시안 콘텐츠 표의 한 행을 펼치면 Field 폼이 나오는 모양. */
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
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setErr(null);
    const supabase = createClient();
    const musclesArr = m.split(",").map((s) => s.trim()).filter(Boolean);
    const aliasesArr = al.split(",").map((s) => s.trim()).filter(Boolean);
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
    if (error) setErr(error.message);
    setState(error ? "err" : "saved");
  }
  const touch = () => setState("idle");

  return (
    <div className="rx-record-row" style={{ cursor: "default", flexWrap: "wrap" }}>
      <span style={{ flex: 1 }}>
        <b>{name}</b>
        <small>{[cat ? t(`exercises.cat.${cat}` as Parameters<typeof t>[0]) : null, station ? `Station ${station.replace("station_", "")}` : null].filter(Boolean).join(" · ") || "—"}</small>
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t("admin.edit")}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </Button>
      {open && (
        <div style={{ flexBasis: "100%", marginTop: 8 }}>
          <div className="rx-form-grid">
            <Field label={t("exercises.detCategory")}>
              <Choice
                label={t("exercises.detCategory")}
                value={cat || "none"}
                onChange={(v) => {
                  setCat(v === "none" ? "" : v);
                  touch();
                }}
                options={[["none", "—"], ...CATEGORIES.map((c) => [c, t(`exercises.cat.${c}` as Parameters<typeof t>[0])] as [string, string])]}
              />
            </Field>
            <Field label={t("exercises.detStation")}>
              <Choice
                label={t("exercises.detStation")}
                value={station || "none"}
                onChange={(v) => {
                  setStation(v === "none" ? "" : v);
                  touch();
                }}
                options={[["none", "—"], ...STATIONS.map((st, i) => [st, `Station ${i + 1}`] as [string, string])]}
              />
            </Field>
            <Field label={`${t("exercises.detTarget")} (${t("admin.commaKeys")})`}>
              <Input
                value={m}
                onChange={(e) => {
                  setM(e.target.value);
                  touch();
                }}
              />
            </Field>
            <Field label={`${t("admin.exAliases")} (${t("admin.commaKeys")})`}>
              <Input
                value={al}
                onChange={(e) => {
                  setAl(e.target.value);
                  touch();
                }}
              />
            </Field>
          </div>
          <Field label={t("exercises.detHowTo")}>
            <Textarea
              value={desc}
              onChange={(e) => {
                setDesc(e.target.value);
                touch();
              }}
              rows={3}
            />
          </Field>
          <Field label={t("admin.mediaUrl")}>
            <Input
              value={media}
              onChange={(e) => {
                setMedia(e.target.value);
                touch();
              }}
            />
          </Field>
          <div className="rx-actions">
            <Button type="button" className="rx-primary" onClick={save} disabled={state === "saving"}>
              {state === "saving" ? t("common.saving") : t("common.save")}
            </Button>
            {state === "saved" && <Hint>{t("profile.saved")}</Hint>}
            {state === "err" && (
              <span role="alert" className="rx-error">
                {err ?? t("common.needLogin")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
