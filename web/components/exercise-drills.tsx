"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export type Drill = {
  id: string;
  title: string;
  body: string | null;
};

export function ExerciseDrills({
  exerciseId,
  initial,
}: {
  exerciseId: string;
  initial: Drill[];
}) {
  const { t } = useI18n();
  const [drills, setDrills] = useState<Drill[]>(initial);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("exercise_drills")
      .insert({
        exercise_id: exerciseId,
        title: title.trim(),
        body: body.trim() || null,
      })
      .select("id, title, body")
      .single();
    setPending(false);
    if (err) return setError(t("exercises.drillErr", { msg: err.message }));
    setDrills((d) => [...d, data as Drill]);
    setTitle("");
    setBody("");
    setOpen(false);
  }

  async function remove(id: string) {
    const prev = drills;
    setDrills((d) => d.filter((x) => x.id !== id));
    const supabase = createClient();
    const { error: err } = await supabase
      .from("exercise_drills")
      .delete()
      .eq("id", id);
    if (err) setDrills(prev);
  }

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{t("exercises.drillsTitle")}</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm font-semibold text-accent hover:underline"
        >
          {t("exercises.drillAdd")}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{t("exercises.drillsHint")}</p>

      {open && (
        <form
          onSubmit={add}
          className="mt-3 grid gap-2 rounded-md bg-surface px-4 py-4"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("exercises.drillTitlePh")}
            aria-label={t("exercises.drillTitle")}
            className="rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("exercises.drillBodyPh")}
            aria-label={t("exercises.drillBody")}
            rows={3}
            className="rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={pending || !title.trim()}
            className="justify-self-start rounded-md bg-accent px-5 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
          >
            {pending ? t("exercises.drillSaving") : t("exercises.drillSave")}
          </button>
        </form>
      )}

      {drills.length === 0 ? (
        <p className="mt-3 rounded-md bg-surface px-4 py-6 text-center text-sm text-muted">
          {t("exercises.drillEmpty")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {drills.map((d) => (
            <li
              key={d.id}
              className="flex items-start justify-between gap-3 rounded-md bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{d.title}</p>
                {d.body && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">
                    {d.body}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(d.id)}
                aria-label={t("common.delete")}
                className="shrink-0 text-muted hover:text-red-400"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
