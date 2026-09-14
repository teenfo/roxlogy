"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { CrewLedgerDelete, CrewLedgerForm, type LedgerEntry } from "@/components/crew-ledger-form";
import { CrewLedgerSettle } from "@/components/crew-ledger-settle";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 러닝 잔액까지 붙인 장부 행 */
export type LedgerTableRow = LedgerEntry & {
  /** 이 거래까지 반영된 장부 잔액 — 서버가 전체 거래 기준으로 계산해 온다 */
  balance: number;
};

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

/** ⋯ 행 메뉴 — 바깥을 덮는 버튼으로 바깥 클릭을 받는다(document 리스너 없이) */
function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-base leading-none text-muted hover:bg-card-hover hover:text-foreground"
      >
        ⋯
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <span className="absolute right-0 top-8 z-20 flex w-[160px] flex-col rounded-[10px] border border-[#333] bg-[#1a1a1a] p-1.5 shadow-[0_12px_30px_rgba(0,0,0,.5)]">
            {children}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * 수입·지출 장부 표 (디자인 시안 §2-a).
 *
 * 날짜별 카드로 쪼개져 있던 목록을 한 장의 표로 모으고, 금액 아래에 **러닝 잔액**을
 * 적는다. 잔액은 필터와 무관하게 전체 거래 기준이라 필터를 걸어도 값이 흔들리지
 * 않는다(서버가 계산해 `balance` 로 넘겨준다).
 *
 * 종류 필터와 검색은 클라이언트에서 한다 — 예전엔 `?k=` 링크라 칩 한 번이 서버
 * 왕복 하나였다. 통장 반영 토글은 시안대로 행 2행 배지로 남겨 둔다.
 */
export function CrewLedgerTable({
  rows,
  crewId,
  today,
  isStaff,
  closed,
  monthLabel,
  locale,
}: {
  rows: LedgerTableRow[];
  crewId: string;
  today: string;
  isStaff: boolean;
  /** 마감된 달이면 수정·삭제를 감춘다 */
  closed: boolean;
  monthLabel: string;
  locale: string;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"all" | "income" | "expense">("all");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (!q ||
        r.title.toLowerCase().includes(q) ||
        (r.memo ?? "").toLowerCase().includes(q)),
  );

  // 합계는 달 전체 기준을 유지한다 — 필터를 걸었다고 이 달 수입이 바뀌면 다른 숫자다
  const income = rows.filter((r) => r.kind === "income").reduce((a, r) => a + r.amount, 0);
  const expense = rows.filter((r) => r.kind === "expense").reduce((a, r) => a + r.amount, 0);
  // 월말 잔액 = 이 달 가장 최근 거래의 러닝 잔액
  const monthEnd = rows[0]?.balance ?? 0;

  const day = (iso: string) => Number(iso.slice(8, 10));
  const weekday = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: "short" });
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
      month: "numeric",
      day: "numeric",
    });

  const cols =
    "grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 sm:grid-cols-[44px_minmax(0,1fr)_120px_28px] sm:gap-3";
  const seg = (k: typeof kind, label: string, n: number) => (
    <button
      key={k}
      type="button"
      aria-pressed={kind === k}
      onClick={() => setKind(k)}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors ${
        kind === k ? "bg-accent text-background" : "text-[#c9c9c9] hover:text-foreground"
      }`}
    >
      {label}
      <span className={`text-[11px] ${kind === k ? "text-[#6b5a00]" : "text-[#777]"}`}>{n}</span>
    </button>
  );

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-[18px] py-3.5">
        <div className="flex flex-wrap gap-1 rounded-full border border-line-mid bg-page p-[3px]">
          {seg("all", t("crew.finKindAll"), rows.length)}
          {seg("income", t("crew.finKindIncome"), rows.filter((r) => r.kind === "income").length)}
          {seg("expense", t("crew.finKindExpense"), rows.filter((r) => r.kind === "expense").length)}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size={1}
          placeholder={t("crew.finSearch")}
          className="ml-auto h-[34px] w-[180px] max-w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-[13px] outline-none focus:border-accent"
        />
      </div>

      <div
        className={`hidden ${cols} border-b border-[#1c1c1c] px-[18px] py-2 text-[11px] font-bold tracking-[0.06em] text-[#777] sm:grid`}
      >
        <span>{t("crew.finColDate")}</span>
        <span>{t("crew.finColDesc")}</span>
        <span className="text-right">{t("crew.finColAmount")}</span>
        <span />
      </div>

      {shown.map((r) => (
        <div key={r.id} className={`${cols} border-b border-[#1c1c1c] px-[18px] py-2.5 hover:bg-card-hover`}>
          <span className="flex shrink-0 items-baseline gap-1 sm:flex-col sm:gap-0">
            <strong className="tabular text-sm font-extrabold">{day(r.entry_date)}</strong>
            <span className="text-xs text-[#666]">{weekday(r.entry_date)}</span>
          </span>

          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {r.source === "dues" ? t("crew.duesEntry", { detail: r.title }) : r.title}
            </span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#777]">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  r.source === "dues"
                    ? "bg-[#2a2500] text-[#e0c53a]"
                    : r.kind === "income"
                      ? "bg-info-bg text-info"
                      : "bg-danger-bg text-danger"
                }`}
              >
                {r.source === "dues"
                  ? t("crew.finBadgeDues")
                  : t(r.kind === "income" ? "crew.finKindIncome" : "crew.finKindExpense")}
              </span>
              {r.method && (
                <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-[10px] font-bold text-foreground/75">
                  {t(`crew.finMethod.${r.method}` as DictKey)}
                </span>
              )}
              {isStaff ? (
                <CrewLedgerSettle
                  id={r.id}
                  entryDate={r.entry_date}
                  settledOn={r.settled_on}
                  label={
                    r.settled_on ? t("crew.finSettledOn", { date: shortDate(r.settled_on) }) : null
                  }
                />
              ) : (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    r.settled_on ? "bg-success-bg text-success" : "bg-label-bg text-label"
                  }`}
                >
                  {r.settled_on
                    ? t("crew.finSettledOn", { date: shortDate(r.settled_on) })
                    : t("crew.finUnsettledBadge")}
                </span>
              )}
              {r.memo && <span className="min-w-0 truncate">{r.memo}</span>}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-1.5 sm:contents">
            <span className="text-right sm:block">
              <span
                className={`tabular block text-sm font-bold ${
                  r.kind === "income" ? "text-success" : ""
                }`}
              >
                {r.kind === "income" ? "+" : "−"}
                {won(r.amount)}
              </span>
              <span className="tabular block text-[11px] text-[#777]">{won(r.balance)}</span>
            </span>
            {isStaff && !closed ? (
              <RowMenu label={t("crew.finRowMenu", { title: r.title })}>
                <CrewLedgerForm crewId={crewId} today={today} entry={r} trigger="menu" />
                <CrewLedgerDelete id={r.id} variant="menu" />
              </RowMenu>
            ) : (
              <span className="hidden sm:block" />
            )}
          </span>
        </div>
      ))}

      {shown.length === 0 && (
        <p className="px-[18px] py-10 text-center text-[13px] text-[#666]">
          {t(rows.length ? "crew.finFilterEmpty" : "crew.finEmpty")}
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-inset px-[18px] py-3 text-xs text-[#777]">
          <span>
            {monthLabel} · {t("crew.finKindIncome")}{" "}
            <strong className="tabular text-success">+{won(income)}</strong> ·{" "}
            {t("crew.finKindExpense")} <strong className="tabular">−{won(expense)}</strong>
          </span>
          <span>
            {t("crew.finMonthEndBalance")}{" "}
            <strong className="tabular text-foreground">{won(monthEnd)}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
