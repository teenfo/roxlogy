"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;

export function ProgramNewForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weeks, setWeeks] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [level, setLevel] = useState<string>("intermediate");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const inputCls =
    "rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent";

  async function handleSave() {
    setError(null);
    if (!title.trim()) return setError(t("programs.errTitle"));
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }
    const { data, error: err } = await supabase
      .from("programs")
      .insert({
        owner_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        weeks: weeks ? Number(weeks) : null,
        start_date: startDate || null,
        end_date: endDate || null,
        level,
        is_public: isPublic,
      })
      .select("id")
      .single();
    setPending(false);
    if (err) return setError(t("programs.errSave", { msg: err.message }));
    router.push(`/programs/${data.id}`);
    router.refresh();
  }

  return (
    <main>
      <Link href="/programs" className="text-sm text-muted hover:text-foreground">
        {t("programs.back")}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t("programs.newTitle")}</h1>

      <div className="mt-6 grid max-w-lg gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("programs.fldTitle")}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("programs.titlePh")}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("programs.fldDesc")}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputCls}
          />
        </label>
        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("programs.fldWeeks")}
            <input
              value={weeks}
              onChange={(e) => setWeeks(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="8"
              className={inputCls}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("programs.fldLevel")}
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className={inputCls}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`predict.level.${l}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("programs.fldStartDate")}
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("programs.fldEndDate")}
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="accent-accent"
          />
          <span>
            {t("programs.fldPublic")}
            <span className="mt-0.5 block text-xs text-muted">
              {t("programs.publicHint")}
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={handleSave}
          disabled={pending}
          className="rounded-md bg-accent px-6 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {pending ? t("common.saving") : t("programs.createBtn")}
        </button>
      </div>
    </main>
  );
}
