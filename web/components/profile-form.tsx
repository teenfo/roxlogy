"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { LinkedAccounts } from "@/components/linked-accounts";
import { LocaleSwitcher } from "@/components/locale-switcher";

const DIVISIONS = ["open", "pro", "doubles", "pro_doubles", "relay"] as const;
const GENDERS = ["male", "female", "other"] as const;

type ProfileFields = {
  display_name: string;
  division: string;
  gender: string;
  height_cm: string;
  weight_kg: string;
};

export function ProfileForm({
  initial,
  email,
}: {
  initial: ProfileFields;
  email: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof ProfileFields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }

    const { error: err } = await supabase
      .from("profiles")
      .update({
        display_name: fields.display_name.trim() || null,
        division: fields.division || null,
        gender: fields.gender || null,
        height_cm: fields.height_cm ? Number(fields.height_cm) : null,
        weight_kg: fields.weight_kg ? Number(fields.weight_kg) : null,
      })
      .eq("id", user.id);

    setPending(false);
    if (err) return setError(t("profile.errSave", { msg: err.message }));
    setSaved(true);
    router.refresh();
  }

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
      <p className="mt-1 text-sm text-muted">{email}</p>

      <div className="mt-6 max-w-md rounded-md bg-surface px-4 py-4">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            {t("profile.language")}
            <span className="mt-0.5 block text-xs text-muted">
              {t("profile.languageDesc")}
            </span>
          </span>
          <LocaleSwitcher />
        </label>
      </div>

      <LinkedAccounts />

      <form onSubmit={handleSave} className="mt-6 grid max-w-md gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("profile.displayName")}
          <input
            value={fields.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
          />
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("raceNew.division")}
            <select
              value={fields.division}
              onChange={(e) => set("division", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            >
              <option value="">{t("dash.unset")}</option>
              {DIVISIONS.map((v) => (
                <option key={v} value={v}>
                  {t(`division.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("profile.gender")}
            <select
              value={fields.gender}
              onChange={(e) => set("gender", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            >
              <option value="">{t("dash.unset")}</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {t(`profile.gender.${g}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("profile.height")}
            <input
              type="number"
              min="0"
              step="0.1"
              value={fields.height_cm}
              onChange={(e) => set("height_cm", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            {t("profile.weight")}
            <input
              type="number"
              min="0"
              step="0.1"
              value={fields.weight_kg}
              onChange={(e) => set("weight_kg", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && <p className="text-sm text-track">{t("profile.saved")}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-6 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </main>
  );
}
