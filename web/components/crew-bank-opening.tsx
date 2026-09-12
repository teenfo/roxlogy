"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/**
 * 통장 기초 잔액 — 운영진만.
 *
 * 통장 잔고를 계산하려면 시작점이 필요하다. 장부를 쓰기 시작한 시점의 통장
 * 잔액을 한 번 적어 두면, 이후로는 "통장에 찍힌" 거래만 더해 잔고가 따라간다.
 */
export function CrewBankOpening({
  crewId,
  openingBalance,
  openingOn,
}: {
  crewId: string;
  openingBalance: number;
  openingOn: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(openingBalance));
  const [on, setOn] = useState(openingOn ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replaceAll(",", ""));
    if (!Number.isFinite(amt)) return setErr(t("crew.finErrInput"));
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("crew_bank").upsert(
      {
        crew_id: crewId,
        opening_balance: Math.round(amt),
        opening_on: on || null,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      },
      { onConflict: "crew_id" },
    );
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 shrink-0 items-center rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold transition-colors hover:border-line-strong"
      >
        {t("crew.finOpeningEdit")}
      </button>
    );
  }

  return (
    <form
      onSubmit={save}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-page px-3 py-2.5"
    >
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("crew.finOpening")}
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          className="tabular h-9 w-32 rounded-lg border border-line-strong bg-page px-2 text-sm outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("crew.finOpeningOn")}
        <input
          type="date"
          value={on}
          onChange={(e) => setOn(e.target.value)}
          className="h-9 rounded-lg border border-line-strong bg-page px-2 text-sm outline-none focus:border-accent"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="flex h-9 items-center rounded-lg bg-accent px-4 text-[13px] font-extrabold text-background disabled:opacity-40"
      >
        {t("common.save")}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="flex h-9 items-center px-2 text-[13px] text-muted hover:text-foreground"
      >
        {t("common.cancel")}
      </button>
      {err && <span className="w-full text-xs text-danger">{err}</span>}
    </form>
  );
}
