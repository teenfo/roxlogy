"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

const input =
  "h-11 w-full rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent";

/** 레이스 생성 — 전체 관리자, 또는 크루 운영진(크루 선택 시) */
export function PftRaceCreateForm({ crews }: { crews: { slug: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [crew, setCrew] = useState(crews[0]?.slug ?? "");
  // 참가 방식 — 코드로 스스로 참가 vs 운영진이 추가(코드 없음)
  const [joinOpen, setJoinOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pft_race_create", {
      p_title: title.trim(),
      p_crew_slug: crew || null,
      p_join_open: joinOpen,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const j = data as { ok?: boolean; code?: string; error?: string };
    if (!j.ok || !j.code) return setErr(t(`pft.race.err.${j.error ?? "unknown"}` as DictKey));
    router.push(`/pft/race/${j.code}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("pft.race.fldTitle")}
        <input
          className={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          required
          placeholder={t("pft.race.titlePh")}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("pft.race.fldCrew")}
        <select className={input} value={crew} onChange={(e) => setCrew(e.target.value)}>
          <option value="">{t("pft.race.noCrew")}</option>
          {crews.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-muted">{t("pft.race.fldJoinMode")}</legend>
        {(
          [
            ["code", true, "pft.race.joinModeCode", "pft.race.joinModeCodeHint"],
            ["staff", false, "pft.race.joinModeStaff", "pft.race.joinModeStaffHint"],
          ] as const
        ).map(([key, value, label, hint]) => (
          <label
            key={key}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 ${
              joinOpen === value ? "border-accent bg-highlight" : "border-line-soft bg-inset"
            }`}
          >
            <input
              type="radio"
              name="join-mode"
              className="mt-0.5 h-4 w-4 accent-accent"
              checked={joinOpen === value}
              onChange={() => setJoinOpen(value)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold">{t(label)}</span>
              <span className="mt-0.5 block text-xs text-muted">{t(hint)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="h-11 rounded-lg bg-accent text-sm font-extrabold text-background hover:brightness-110 disabled:opacity-40"
      >
        {t("pft.race.create")}
      </button>
    </form>
  );
}

/** 코드로 참가 */
export function PftRaceJoinForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return setErr(t("pft.race.err.race_not_found"));
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pft_race_join", { p_code: c });
    setBusy(false);
    if (error) return setErr(error.message);
    const j = data as { ok?: boolean; code?: string; error?: string };
    if (!j.ok) return setErr(t(`pft.race.err.${j.error ?? "unknown"}` as DictKey));
    router.push(`/pft/race/${j.code ?? c}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("pft.race.code")}
        <input
          className={`${input} text-center font-mono text-2xl font-extrabold uppercase tracking-[0.3em]`}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABC123"
          required
        />
      </label>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="h-11 rounded-lg bg-accent text-sm font-extrabold text-background hover:brightness-110 disabled:opacity-40"
      >
        {t("pft.race.join")}
      </button>
    </form>
  );
}
