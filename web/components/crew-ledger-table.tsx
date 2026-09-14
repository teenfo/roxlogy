"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { CrewLedgerDelete, CrewLedgerForm, type LedgerEntry } from "@/components/crew-ledger-form";
import { CrewLedgerSettle } from "@/components/crew-ledger-settle";
import { categoryBadgeClass, categoryDictKey } from "@/lib/ledger-category";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 러닝 잔액까지 붙인 장부 행 */
export type LedgerTableRow = LedgerEntry & {
  /** 이 거래까지 반영된 장부 잔액 — 서버가 전체 거래 기준으로 계산해 온다 */
  balance: number;
  /** 회비 확정으로 생긴 행의 회차 키 (마이그레이션 108). 손으로 적은 거래는 null */
  dues_group: string | null;
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
  // 회비 입금 묶어 보기 — 21명 월회비를 한 번에 확정하면 장부에 21줄이 생기는데,
  // 장부를 읽는 사람에게 그건 거래 21건이 아니라 "9월 월회비 21명" 한 건이다.
  const [grouped, setGrouped] = useState(true);

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

  /** 묶는 단위는 **회차 + 날짜**다. 회차 키만 보면 여러 날에 걸친 회차(월회비를
   *  7일에 8명, 13일에 2명 확정한 경우)가 한 줄로 접히면서 7일 돈이 13일로 올라간다.
   *  장부에서 날짜를 옮기는 건 그냥 틀린 값이다. */
  const groupKey = (r: LedgerTableRow) =>
    r.dues_group ? `${r.dues_group}|${r.entry_date}` : null;
  const groupCount = new Map<string, number>();
  for (const r of shown) {
    const k = groupKey(r);
    if (k) groupCount.set(k, (groupCount.get(k) ?? 0) + 1);
  }
  const hasGroups = [...groupCount.values()].some((n) => n > 1);

  /** 표에 그릴 것 — 낱개 행이거나, 같은 날 같은 회차를 접은 한 줄 */
  type Item =
    | { type: "row"; row: LedgerTableRow }
    | { type: "group"; key: string; rows: LedgerTableRow[]; amount: number; date: string };
  const items: Item[] = [];
  if (grouped) {
    const at = new Map<string, number>();
    for (const r of shown) {
      const key = groupKey(r);
      if (!key || (groupCount.get(key) ?? 0) < 2) {
        items.push({ type: "row", row: r });
        continue;
      }
      const i = at.get(key);
      if (i == null) {
        at.set(key, items.length);
        items.push({ type: "group", key, rows: [r], amount: r.amount, date: r.entry_date });
      } else {
        const g = items[i] as Extract<Item, { type: "group" }>;
        g.rows.push(r);
        g.amount += r.amount;
      }
    }
  } else {
    for (const r of shown) items.push({ type: "row", row: r });
  }

  /** 회차 제목 — 장부 제목이 "<청구 이름> — <회원 이름>" 이라 앞부분이 회차 이름이다 */
  const groupTitle = (g: Extract<Item, { type: "group" }>) => {
    const [head] = g.rows[0].title.split(" — ");
    return head || g.rows[0].title;
  };

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
        {hasGroups && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-accent"
            />
            {t("crew.finGroupDues")}
          </label>
        )}
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

      {items.map((it) =>
        it.type === "group" ? (
          <div
            key={it.key}
            className={`${cols} border-b border-[#1c1c1c] px-[18px] py-2.5 hover:bg-card-hover`}
          >
            <span className="flex shrink-0 items-baseline gap-1 sm:flex-col sm:gap-0">
              <strong className="tabular text-sm font-extrabold">{day(it.date)}</strong>
              <span className="text-xs text-[#666]">{weekday(it.date)}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{groupTitle(it)}</span>
              <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#777]">
                <span className="shrink-0 rounded bg-[#2a2500] px-1.5 py-0.5 text-[10px] font-bold text-[#e0c53a]">
                  {t("crew.finBadgeDues")}
                </span>
                <span>{t("crew.finGroupOf", { n: it.rows.length })}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 sm:contents">
              {/* 잔액은 적지 않는다 — 회차 행들 사이에 다른 거래가 끼어 있을 수 있어
                  (회원 한 명씩 월회비→회차비 순으로 확정하면 실제로 그렇다) 한 줄에
                  걸어 둘 "이 시점의 잔액"이라는 게 없다. 낱개로 펴면 행마다 보인다. */}
              <span className="text-right sm:block">
                <span className="tabular block text-sm font-bold text-success">
                  +{won(it.amount)}
                </span>
                <span className="block text-[11px] text-[#777]">{t("crew.finGroupNoBalance")}</span>
              </span>
              {/* 묶은 줄은 고칠 수 없다 — 개별 행을 고치려면 체크를 끈다 */}
              <span className="hidden sm:block" />
            </span>
          </div>
        ) : (
        <div key={it.row.id} className={`${cols} border-b border-[#1c1c1c] px-[18px] py-2.5 hover:bg-card-hover`}>
          <span className="flex shrink-0 items-baseline gap-1 sm:flex-col sm:gap-0">
            <strong className="tabular text-sm font-extrabold">{day(it.row.entry_date)}</strong>
            <span className="text-xs text-[#666]">{weekday(it.row.entry_date)}</span>
          </span>

          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {it.row.source === "dues" ? t("crew.duesEntry", { detail: it.row.title }) : it.row.title}
            </span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#777]">
              {/* 분류 배지 — 고른 값이 있으면 그걸, 없으면 회비/수입/지출로 떨어진다.
                  회비 확정으로 생긴 행은 category 가 비어 있어도 회비다. */}
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${categoryBadgeClass(
                  it.row.kind,
                  it.row.category ?? (it.row.source === "dues" ? "dues" : null),
                )}`}
              >
                {it.row.category
                  ? t(categoryDictKey(it.row.category))
                  : it.row.source === "dues"
                    ? t("crew.finBadgeDues")
                    : t(it.row.kind === "income" ? "crew.finKindIncome" : "crew.finKindExpense")}
              </span>
              {it.row.method && (
                <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-[10px] font-bold text-foreground/75">
                  {t(`crew.finMethod.${it.row.method}` as DictKey)}
                </span>
              )}
              {isStaff ? (
                <CrewLedgerSettle
                  id={it.row.id}
                  entryDate={it.row.entry_date}
                  settledOn={it.row.settled_on}
                  label={
                    it.row.settled_on ? t("crew.finSettledOn", { date: shortDate(it.row.settled_on) }) : null
                  }
                />
              ) : (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    it.row.settled_on ? "bg-success-bg text-success" : "bg-label-bg text-label"
                  }`}
                >
                  {it.row.settled_on
                    ? t("crew.finSettledOn", { date: shortDate(it.row.settled_on) })
                    : t("crew.finUnsettledBadge")}
                </span>
              )}
              {it.row.memo && <span className="min-w-0 truncate">{it.row.memo}</span>}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-1.5 sm:contents">
            <span className="text-right sm:block">
              <span
                className={`tabular block text-sm font-bold ${
                  it.row.kind === "income" ? "text-success" : ""
                }`}
              >
                {it.row.kind === "income" ? "+" : "−"}
                {won(it.row.amount)}
              </span>
              <span className="tabular block text-[11px] text-[#777]">{won(it.row.balance)}</span>
            </span>
            {isStaff && !closed ? (
              <RowMenu label={t("crew.finRowMenu", { title: it.row.title })}>
                <CrewLedgerForm crewId={crewId} today={today} entry={it.row} trigger="menu" />
                <CrewLedgerDelete id={it.row.id} variant="menu" />
              </RowMenu>
            ) : (
              <span className="hidden sm:block" />
            )}
          </span>
        </div>
        ),
      )}

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
