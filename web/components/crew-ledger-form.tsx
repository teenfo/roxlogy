"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { LEDGER_CATEGORIES, categoryDictKey, isValidCategory } from "@/lib/ledger-category";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RoxDialog } from "@/components/rox/dialog";
import { Choice, Field, Hint, Panel } from "@/components/rox/ui";

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
 * 크루 회계 내역 추가·수정 (스태프 전용) — 시안 finance.tsx EntryForm 그대로:
 * Panel "거래 추가"(.rx-finance-add)[ .rx-finance-field-pair(유형·거래일) · 분류 · 금액 · 거래 내용 ·
 * .rx-finance-field-pair(결제 수단·정산일) · 메모 · 버튼 · Hint ].
 *
 * entry 를 주면 수정 모드가 된다 — 추가와 칸이 똑같아야 해서 한 컴포넌트로 둔다.
 * trigger="inline" 은 사이드 카드에 폼을 그대로 편다(시안 자리). 나머지는 RoxDialog 로 띄운다.
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
  const [kind, setKind] = useState<"income" | "expense">(entry?.kind ?? "expense");
  const [date, setDate] = useState(entry?.entry_date ?? today);
  const [title, setTitle] = useState(entry?.title ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [category, setCategory] = useState(entry?.category ?? "");
  // 결제 수단·통장 반영일 — 통장과 대사하려면 이 둘이 있어야 한다. 둘 다 선택이다.
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
      // 종류(수입/지출)가 바뀌어 못 쓰게 된 값만 비운다. **모른다고 지우지 않는다** —
      // 분류 목록을 늘린 마이그레이션이 배포보다 먼저 반영되면 옛 번들이 새 분류를
      // 모르는 창이 생기는데, 거기서 지워 버리면 고치지도 않은 값이 날아간다
      // (2026-09-14 실제로 한 행이 그렇게 비워졌다).
      category: category || null,
    };
    const { error } = editing
      ? await supabase.from("crew_ledger").update(values).eq("id", entry.id).eq("crew_id", crewId)
      : await (async () => {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          return supabase.from("crew_ledger").insert({ ...values, crew_id: crewId, created_by: user?.id });
        })();
    setBusy(false);
    if (error) {
      setErr(error.message.includes("ledger_month_closed") ? t("crew.errMonthClosed") : error.message);
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

  const setKindSafe = (k: "income" | "expense") => {
    setKind(k);
    // 수입으로 바꾸면 "카드"는 목록에서 사라진다 — 남겨 두면 화면에 없는 값이 저장된다
    if (!(METHODS[k] as readonly string[]).includes(method)) setMethod("");
    // 수입↔지출을 오가면 분류 목록이 통째로 바뀐다 — 남겨 두면 저장 때 떨어진다
    if (category && !isValidCategory(k, category)) setCategory("");
  };

  const categoryOptions: [string, string][] = [
    ["none", t("crew.finCatNone")],
    // 목록에 없는 값(새 분류를 모르는 옛 번들)도 칸을 만들어 둔다
    ...(category && !isValidCategory(kind, category)
      ? [[category, t(categoryDictKey(category))] as [string, string]]
      : []),
    ...LEDGER_CATEGORIES[kind].map((c) => [c, t(categoryDictKey(c))] as [string, string]),
  ];
  const methodOptions: [string, string][] = [
    ["none", t(kind === "income" ? "crew.finMethodNoneIn" : "crew.finMethodNone")],
    ...METHODS[kind].map((m) => [m, t(`crew.finMethod.${m}` as Parameters<typeof t>[0])] as [string, string]),
  ];

  const fields = (
    <>
      {fromDues && <Hint>{t("crew.finDuesLocked")}</Hint>}
      <div className="rx-finance-field-pair">
        <Field label={t("crew.finKindLabel")}>
          <Choice
            label={t("crew.finKindLabel")}
            value={kind}
            onChange={(v) => !fromDues && setKindSafe(v as "income" | "expense")}
            options={[
              ["expense", t("crew.finKindExpense")],
              ["income", t("crew.finKindIncome")],
            ]}
          />
        </Field>
        <Field label={t("crew.finDate")}>
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t("crew.finCategory")}>
        <Choice
          label={t("crew.finCategory")}
          value={category || "none"}
          onChange={(v) => setCategory(v === "none" ? "" : v)}
          options={categoryOptions}
        />
      </Field>
      <Field label={`${t("crew.finAmount")} (₩) *`}>
        <Input
          type="text"
          inputMode="numeric"
          required
          value={amount}
          disabled={fromDues}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t("crew.finAmount")}
        />
      </Field>
      <Field label={`${t("crew.finTitle")} *`}>
        <Input
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("crew.finTitle")}
        />
      </Field>
      <div className="rx-finance-field-pair">
        <Field label={t("crew.finMethodNone")}>
          <Choice
            label={t("crew.finMethodNone")}
            value={method || "none"}
            onChange={(v) => setMethod(v === "none" ? "" : v)}
            options={methodOptions}
          />
        </Field>
        <Field label={t("crew.finSettledOptional")}>
          <Input type="date" value={settledOn} onChange={(e) => setSettledOn(e.target.value)} />
        </Field>
      </div>
      {kind === "income" && method === "cash" && <Hint>{t("crew.finCashInHint")}</Hint>}
      <Field label={t("crew.finMemo")}>
        <Textarea rows={2} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
    </>
  );

  // 사이드 카드에 그대로 펴는 모양 — 모달을 열지 않고 바로 입력한다
  if (trigger === "inline") {
    return (
      <Panel title={t("crew.finEntryAdd")} className="rx-finance-add">
        <form onSubmit={save}>
          {fields}
          <Button type="submit" className="rx-primary rx-wide" disabled={busy}>
            <Plus size={16} />
            {busy ? t("common.saving") : t("crew.finAddToLedger")}
          </Button>
          <Hint>{t("crew.finSettledLabel")}</Hint>
        </form>
      </Panel>
    );
  }

  return (
    <>
      {trigger === "icon" ? (
        <Button variant="ghost" size="sm" type="button" onClick={openModal} aria-label={t("common.edit")}>
          ✎
        </Button>
      ) : trigger === "menu" ? (
        <Button variant="ghost" size="sm" type="button" onClick={openModal}>
          {t("common.edit")}
        </Button>
      ) : (
        <Button variant="outline" type="button" onClick={openModal}>
          <Plus size={16} />
          {t("crew.finAdd")}
        </Button>
      )}
      <RoxDialog open={open} onOpenChange={setOpen} title={t(editing ? "crew.finEdit" : "crew.finAdd")}>
        {open && (
          <form onSubmit={save}>
            {fields}
            <div className="rx-actions">
              <Button type="submit" className="rx-primary" disabled={busy}>
                {busy ? t("common.saving") : t(editing ? "common.save" : "crew.finSave")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          </form>
        )}
      </RoxDialog>
    </>
  );
}

/** 내역 삭제 (스태프 전용) */
export function CrewLedgerDelete({ id }: { id: string; variant?: "icon" | "menu" }) {
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

  return (
    <Button variant="ghost" size="sm" type="button" className="rx-pft-close" onClick={del} disabled={busy}>
      {t("crew.finDelete")}
    </Button>
  );
}
