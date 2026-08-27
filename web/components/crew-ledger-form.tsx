"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

/** 크루 회계 내역 추가 (스태프 전용, 접이식) */
export function CrewLedgerForm({ crewId }: { crewId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replaceAll(",", ""));
    if (!title.trim() || !Number.isFinite(amt) || amt <= 0) {
      setErr(t("crew.finErrInput"));
      return;
    }
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("crew_ledger").insert({
      crew_id: crewId,
      entry_date: date,
      kind,
      amount: Math.round(amt),
      title: title.trim(),
      memo: memo.trim() || null,
      created_by: user?.id,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setTitle("");
    setAmount("");
    setMemo("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-accent/40 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10"
      >
        + {t("crew.finAdd")}
      </button>
    );
  }

  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-2 rounded-md bg-surface p-4"
    >
      <div className="flex flex-wrap gap-2">
        <select
          className={input}
          value={kind}
          onChange={(e) => setKind(e.target.value as "income" | "expense")}
        >
          <option value="income">{t("crew.finKindIncome")}</option>
          <option value="expense">{t("crew.finKindExpense")}</option>
        </select>
        <input
          type="date"
          className={input}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <input
          type="text"
          inputMode="numeric"
          className={`${input} w-32`}
          placeholder={t("crew.finAmount")}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <input
        className={input}
        placeholder={t("crew.finTitle")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        required
      />
      <input
        className={input}
        placeholder={t("crew.finMemo")}
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        maxLength={500}
      />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {busy ? t("common.saving") : t("crew.finSave")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-sm text-muted hover:text-foreground"
        >
          {t("common.close")}
        </button>
      </div>
    </form>
  );
}

/** 내역 삭제 (스태프 전용) */
export function CrewLedgerDelete({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(t("crew.finDeleteConfirm"))) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("crew_ledger").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={del}
      disabled={busy}
      className="shrink-0 text-xs text-muted hover:text-red-400 disabled:opacity-40"
      aria-label={t("crew.finDelete")}
    >
      ✕
    </button>
  );
}
