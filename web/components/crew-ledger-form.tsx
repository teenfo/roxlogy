"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Dialog } from "@/components/ui/dialog";
import { LEDGER_CATEGORIES, categoryDictKey, isValidCategory } from "@/lib/ledger-category";

const input =
  "rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * 수단은 "어떻게 냈나"가 아니라 "이 돈이 통장에 언제 찍히나"를 가늠하려고 있다.
 * 그래서 수입에는 카드가 없다 — 받는 쪽에 카드 결제란 게 없고, 남겨 두면
 * 통장 대사에서 뜻이 통하지 않는다.
 */
const METHODS = {
  income: ["transfer", "cash", "other"],
  expense: ["cash", "card", "transfer", "other"],
} as const satisfies Record<"income" | "expense", readonly string[]>;

export type LedgerEntry = {
  id: string;
  entry_date: string;
  kind: "income" | "expense";
  amount: number;
  title: string;
  memo: string | null;
  method: string | null;
  settled_on: string | null;
  source: string | null;
  /** 거래 분류(영어 키) — 옛 행은 null */
  category: string | null;
};

/**
 * 크루 회계 내역 추가·수정 (스태프 전용).
 *
 * entry 를 주면 수정 모드가 된다 — 추가와 칸이 똑같아야 해서 한 컴포넌트로 둔다.
 * 툴바(장부/회비 탭 오른쪽)나 내역 행에 버튼으로 앉아 있고, 폼은 모달로 띄운다.
 * 툴바 안에서 펼치면 월 선택 바와 탭이 아래로 밀려 내려간다.
 */
export function CrewLedgerForm({
  crewId,
  today,
  entry,
  trigger = "button",
}: {
  crewId: string;
  /** 서버에서 계산한 사용자 시간대의 오늘 (UTC 로 하루 어긋나는 것 방지) */
  today: string;
  /** 있으면 수정 모드 */
  entry?: LedgerEntry;
  /** 어떤 모양으로 앉을지 — inline 은 사이드 카드에 폼을 그대로 편다(모달 없음) */
  trigger?: "button" | "icon" | "menu" | "inline";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const editing = entry != null;
  // 회비 확정으로 생긴 행은 청구(crew_dues_charges)와 금액이 짝을 이룬다.
  // 여기서 금액·종류를 바꾸면 회비 보드와 장부가 어긋나므로 잠근다.
  const fromDues = entry?.source === "dues";
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"income" | "expense">(
    entry?.kind ?? "expense",
  );
  const [date, setDate] = useState(entry?.entry_date ?? today);
  const [title, setTitle] = useState(entry?.title ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [category, setCategory] = useState(entry?.category ?? "");
  // 결제 수단·통장 반영일 — 통장과 대사하려면 이 둘이 있어야 한다.
  // 둘 다 선택이다: 예전처럼 금액만 적고 넘어갈 수 있어야 한다.
  const [method, setMethod] = useState(entry?.method ?? "");
  const [settledOn, setSettledOn] = useState(entry?.settled_on ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** 열 때마다 서버 값으로 되돌린다 — 고치다 취소한 값이 남으면 안 된다 */
  function openModal() {
    if (entry) {
      setKind(entry.kind);
      setDate(entry.entry_date);
      setTitle(entry.title);
      setAmount(String(entry.amount));
      setMemo(entry.memo ?? "");
      setCategory(entry.category ?? "");
      setMethod(entry.method ?? "");
      setSettledOn(entry.settled_on ?? "");
    }
    setErr(null);
    setOpen(true);
  }

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
    const values = {
      entry_date: date,
      kind,
      amount: Math.round(amt),
      title: title.trim(),
      memo: memo.trim() || null,
      method: method || null,
      settled_on: settledOn || null,
      // 종류와 짝이 안 맞는 값은 DB 체크 제약에 걸린다 — 보내기 전에 떨군다
      // 종류(수입/지출)가 바뀌어 못 쓰게 된 값만 비운다. **모른다고 지우지 않는다** —
      // 분류 목록을 늘린 마이그레이션이 배포보다 먼저 반영되면 옛 번들이 새 분류를
      // 모르는 창이 생기는데, 거기서 지워 버리면 고치지도 않은 값이 날아간다
      // (2026-09-14 실제로 한 행이 그렇게 비워졌다).
      category: category || null,
    };
    const { error } = editing
      ? await supabase
          .from("crew_ledger")
          .update(values)
          .eq("id", entry.id)
          .eq("crew_id", crewId)
      : await (async () => {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          return supabase
            .from("crew_ledger")
            .insert({ ...values, crew_id: crewId, created_by: user?.id });
        })();
    setBusy(false);
    if (error) {
      setErr(
        error.message.includes("ledger_month_closed")
          ? t("crew.errMonthClosed")
          : error.message,
      );
      return;
    }
    if (!editing) {
      setTitle("");
      setAmount("");
      setMemo("");
      setCategory("");
      setMethod("");
      setSettledOn("");
    }
    setOpen(false);
    router.refresh();
  }

  const fields = (
    <>
      {fromDues && <p className="text-xs text-muted">{t("crew.finDuesLocked")}</p>}
      <div className="flex flex-wrap gap-2">
        <select
          className={input}
          aria-label={t("crew.finKindIncome")}
          value={kind}
          disabled={fromDues}
          onChange={(e) => {
            const k = e.target.value as "income" | "expense";
            setKind(k);
            // 수입으로 바꾸면 "카드"는 목록에서 사라진다 — 남겨 두면
            // 화면에 없는 값이 저장된다
            if (!(METHODS[k] as readonly string[]).includes(method)) setMethod("");
            // 수입↔지출을 오가면 분류 목록이 통째로 바뀐다 — 남겨 두면 저장 때 떨어진다
            if (category && !isValidCategory(k, category)) setCategory("");
          }}
        >
          <option value="income">{t("crew.finKindIncome")}</option>
          <option value="expense">{t("crew.finKindExpense")}</option>
        </select>
        <input
          type="date"
          aria-label={t("crew.finDate")}
          className={input}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>
      {/* 분류는 제 줄을 쓴다 — 종류·날짜와 한 줄에 두면 좁은 화면에서 몇 글자만 남는다 */}
      <select
        className={input}
        aria-label={t("crew.finCategory")}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">{t("crew.finCatNone")}</option>
        {/* 목록에 없는 값(새 분류를 모르는 옛 번들)도 칸을 만들어 둔다 —
            안 그러면 "미분류"로 보이고, 저장하면 실제로 미분류가 된다 */}
        {category && !isValidCategory(kind, category) && (
          <option value={category}>{t(categoryDictKey(category))}</option>
        )}
        {LEDGER_CATEGORIES[kind].map((c) => (
          <option key={c} value={c}>
            {t(categoryDictKey(c))}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          inputMode="numeric"
          size={1}
          className={`${input} w-32 min-w-0 flex-1`}
          placeholder={t("crew.finAmount")}
          value={amount}
          disabled={fromDues}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <input
        className={input}
        size={1}
        placeholder={t("crew.finTitle")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        required
      />
      <div className="flex flex-wrap gap-2">
        <select
          className={`${input} min-w-0 flex-1`}
          aria-label={t("crew.finMethodNone")}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="">
            {t(kind === "income" ? "crew.finMethodNoneIn" : "crew.finMethodNone")}
          </option>
          {METHODS[kind].map((mth) => (
            <option key={mth} value={mth}>
              {t(`crew.finMethod.${mth}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
          {t("crew.finSettledLabel")}
          <input
            type="date"
            size={1}
            className={`${input} min-w-0 flex-1`}
            value={settledOn}
            onChange={(e) => setSettledOn(e.target.value)}
          />
        </label>
      </div>
      {kind === "income" && method === "cash" && (
        <p className="text-xs text-muted">{t("crew.finCashInHint")}</p>
      )}
      <input
        className={input}
        size={1}
        placeholder={t("crew.finMemo")}
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        maxLength={500}
      />
      {err && (
        <p role="alert" className="text-xs text-danger">
          {err}
        </p>
      )}
    </>
  );

  // 사이드 카드에 그대로 펴는 모양 — 모달을 열지 않고 바로 입력한다
  if (trigger === "inline") {
    return (
      <form
        onSubmit={save}
        className="flex flex-col gap-2 overflow-hidden rounded-[14px] border border-line bg-card p-[18px]"
      >
        <p className="text-[15px] font-extrabold">{t("crew.finAdd")}</p>
        {fields}
        <button
          type="submit"
          disabled={busy}
          className="mt-1 h-10 rounded-lg bg-accent text-sm font-extrabold text-background hover:brightness-110 disabled:opacity-40"
        >
          {busy ? t("common.saving") : t("crew.finSave")}
        </button>
      </form>
    );
  }

  return (
    <>
      {trigger === "icon" ? (
        <button
          type="button"
          onClick={openModal}
          aria-label={t("common.edit")}
          className="-m-2 shrink-0 p-2 text-xs text-muted transition-colors hover:text-accent"
        >
          ✎
        </button>
      ) : trigger === "menu" ? (
        <button
          type="button"
          onClick={openModal}
          className="rounded-md px-2.5 py-2 text-left text-[13px] text-foreground hover:bg-[#222]"
        >
          {t("common.edit")}
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className="flex h-9 shrink-0 items-center rounded-[10px] border border-accent/40 px-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
        >
          + {t("crew.finAdd")}
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={t(editing ? "crew.finEdit" : "crew.finAdd")}
        closeLabel={t("common.cancel")}
        panelClassName="max-w-lg"
      >
        {open && (
          <form onSubmit={save} className="flex flex-col gap-2 rounded-md bg-surface p-4">
            <p className="text-sm font-semibold">
              {t(editing ? "crew.finEdit" : "crew.finAdd")}
            </p>
            {fields}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
              >
                {busy ? t("common.saving") : t(editing ? "common.save" : "crew.finSave")}
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
        )}
      </Dialog>
    </>
  );
}

/** 내역 삭제 (스태프 전용) */
export function CrewLedgerDelete({
  id,
  variant = "icon",
}: {
  id: string;
  variant?: "icon" | "menu";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(t("crew.finDeleteConfirm"))) return;
    setBusy(true);
    const supabase = createClient();
    // supabase-js 는 실패해도 throw 하지 않는다 — 마감된 달이면 트리거가 막는데
    // 조용히 넘기면 새로고침 뒤 행이 그대로라 "안 지워졌다"로만 보인다.
    const { error } = await supabase.from("crew_ledger").delete().eq("id", id);
    setBusy(false);
    if (error) {
      alert(t("crew.finDeleteFailed"));
      return;
    }
    router.refresh();
  }

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={del}
        disabled={busy}
        className="rounded-md px-2.5 py-2 text-left text-[13px] text-danger hover:bg-danger-card disabled:opacity-40"
      >
        {t("crew.finDelete")}…
      </button>
    );
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
