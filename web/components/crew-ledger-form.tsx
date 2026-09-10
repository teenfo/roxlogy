"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * 크루 회계 내역 추가 (스태프 전용).
 *
 * 툴바(월 선택 바 왼쪽)에 버튼으로 앉아 있고, 폼은 모달로 띄운다 — 툴바 안에서
 * 펼치면 월 선택 바와 탭이 아래로 밀려 내려간다.
 */
export function CrewLedgerForm({
  crewId,
  today,
}: {
  crewId: string;
  /** 서버에서 계산한 사용자 시간대의 오늘 (UTC 로 하루 어긋나는 것 방지) */
  today: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  // 결제 수단·통장 반영일 — 통장과 대사하려면 이 둘이 있어야 한다.
  // 둘 다 선택이다: 예전처럼 금액만 적고 넘어갈 수 있어야 한다.
  const [method, setMethod] = useState("");
  const [settledOn, setSettledOn] = useState("");
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
      method: method || null,
      settled_on: settledOn || null,
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
    setMethod("");
    setSettledOn("");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 shrink-0 items-center rounded-[10px] border border-accent/40 px-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
      >
        + {t("crew.finAdd")}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-10"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={save}
              className="flex flex-col gap-2 rounded-md bg-surface p-4"
            >
              <p className="text-sm font-semibold">{t("crew.finAdd")}</p>
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
              <div className="flex flex-wrap gap-2">
                <select
                  className={input}
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="">{t("crew.finMethodNone")}</option>
                  {(["cash", "card", "transfer", "other"] as const).map((mth) => (
                    <option key={mth} value={mth}>
                      {t(`crew.finMethod.${mth}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
                <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
                  {t("crew.finSettledLabel")}
                  <input
                    type="date"
                    className={`${input} min-w-0 flex-1`}
                    value={settledOn}
                    onChange={(e) => setSettledOn(e.target.value)}
                  />
                </label>
              </div>
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
          </div>
        </div>
      )}
    </>
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
      className="-m-2 shrink-0 p-2 text-xs text-muted hover:text-red-400 disabled:opacity-40"
      aria-label={t("crew.finDelete")}
    >
      ✕
    </button>
  );
}
