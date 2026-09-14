"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { CrewLedgerDelete, CrewLedgerForm, type LedgerEntry } from "@/components/crew-ledger-form";
import { CrewLedgerSettle } from "@/components/crew-ledger-settle";
import { Dialog } from "@/components/ui/dialog";
import { categoryBadgeClass, categoryDictKey, isDuesCategory } from "@/lib/ledger-category";
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
  /** 세부 내역을 연 묶음의 키 — 접힌 줄을 누르면 안에 뭐가 들었는지 본다 */
  const [openKey, setOpenKey] = useState<string | null>(null);

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
  const fullDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
      month: "numeric",
      day: "numeric",
    });

  /** 묶는 단위는 **분류 + 날짜**다.
   *  - 분류로 묶는다: 장부를 읽을 때 궁금한 건 "그날 장소 대여로 얼마"지 영수증
   *    한 장 한 장이 아니다. 회비도 월회비·회차비가 따로 분류라 섞이지 않는다.
   *  - 날짜를 키에 넣는다: 분류만 보면 여러 날에 걸친 것(월회비를 6일에 8명,
   *    13일에 2명 확정)이 한 줄로 접히면서 6일 돈이 13일로 올라간다. 장부에서
   *    날짜를 옮기는 건 그냥 틀린 값이다.
   *  분류가 비었지만 회차 키가 있는 옛 회비 행(마감된 달은 소급하지 않았다)은
   *  회차 키로 묶어 준다 — 안 그러면 그 달만 낱개로 늘어진다. */
  const groupKey = (r: LedgerTableRow) => {
    const axis = r.category ?? r.dues_group;
    return axis ? `${axis}|${r.entry_date}` : null;
  };
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

  /** 묶음 제목은 분류 이름이다. 분류가 없는 옛 회비 행만 장부 제목에서 뽑는다
   *  — 제목이 "<청구 이름> — <회원 이름>" 꼴이라 앞부분이 회차 이름이다. */
  const groupTitle = (g: Extract<Item, { type: "group" }>) => {
    const head = g.rows[0];
    if (head.category) return t(categoryDictKey(head.category));
    return head.title.split(" — ")[0] || head.title;
  };

  /** 모달에 띄울 묶음. 필터가 바뀌어 사라졌으면 null 이라 모달도 닫힌다. */
  const openGroup = openKey
    ? (items.find((i) => i.type === "group" && i.key === openKey) as
        | Extract<Item, { type: "group" }>
        | undefined)
    : undefined;

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
      {/* 묶인 줄을 누르면 안에 든 거래를 그대로 펼쳐 보여 준다 — 체크를 끄지 않고도
          누가·얼마를 확인하고 바로 고치거나 지울 수 있어야 한다. */}
      <Dialog
        open={!!openGroup}
        onClose={() => setOpenKey(null)}
        label={openGroup ? groupTitle(openGroup) : ""}
        closeLabel={t("common.close")}
        variant="center"
        panelClassName="max-w-lg rounded-2xl border border-line bg-card text-foreground"
      >
        {openGroup && (
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-extrabold">{groupTitle(openGroup)}</h3>
              <span
                className={`tabular text-sm font-bold ${
                  openGroup.rows[0].kind === "income" ? "text-success" : ""
                }`}
              >
                {openGroup.rows[0].kind === "income" ? "+" : "−"}
                {won(openGroup.amount)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {fullDate(openGroup.date)} ·{" "}
              {t(
                isDuesCategory(openGroup.rows[0].category) || openGroup.rows[0].dues_group
                  ? "crew.finGroupOf"
                  : "crew.finGroupOfN",
                { n: openGroup.rows.length },
              )}
            </p>

            <ul className="mt-3 flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto">
              {openGroup.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-inset px-3 py-2"
                >
                  {/* 회비 행 제목은 "<청구 이름> — <회원 이름>" 이라 뒷부분이 사람이다.
                      묶음 제목이 앞부분을 이미 말하고 있으니 여기선 뒤만 남긴다. */}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {r.title.includes(" — ") ? r.title.split(" — ").slice(1).join(" — ") : r.title}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      r.settled_on ? "bg-success-bg text-success" : "bg-label-bg text-label"
                    }`}
                  >
                    {r.settled_on
                      ? t("crew.finSettledOn", { date: shortDate(r.settled_on) })
                      : t("crew.finUnsettledBadge")}
                  </span>
                  <span className="tabular shrink-0 text-[13px] font-bold">{won(r.amount)}</span>
                  {/* 묶음 안에서 바로 고친다 — 접힌 줄 하나가 사람 21명이라
                      "펴서 보기"로 돌아가 그 사람을 다시 찾게 하면 손이 너무 많이 간다.
                      ⋯ 메뉴 대신 아이콘을 쓰는 건 목록이 스크롤되기 때문이다(잘린다). */}
                  {isStaff && !closed && (
                    <span className="flex shrink-0 items-center gap-1 self-center">
                      <CrewLedgerForm crewId={crewId} today={today} entry={r} trigger="icon" />
                      <CrewLedgerDelete id={r.id} />
                    </span>
                  )}
                  {r.memo && (
                    <span className="w-full truncate text-[11px] text-[#777]">{r.memo}</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpenKey(null)}
                className="rounded-lg bg-control px-4 py-1.5 text-xs font-semibold"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </Dialog>

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
          <button
            key={it.key}
            type="button"
            onClick={() => setOpenKey(it.key)}
            aria-label={t("crew.finGroupOpen", { title: groupTitle(it) })}
            className={`${cols} w-full border-b border-[#1c1c1c] px-[18px] py-2.5 text-left hover:bg-card-hover`}
          >
            <span className="flex shrink-0 items-baseline gap-1 sm:flex-col sm:gap-0">
              <strong className="tabular text-sm font-extrabold">{day(it.date)}</strong>
              <span className="text-xs text-[#666]">{weekday(it.date)}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{groupTitle(it)}</span>
              <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#777]">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${categoryBadgeClass(
                    it.rows[0].kind,
                    it.rows[0].category ?? (it.rows[0].dues_group ? "dues_monthly" : null),
                  )}`}
                >
                  {it.rows[0].kind === "income"
                    ? t("crew.finKindIncome")
                    : t("crew.finKindExpense")}
                </span>
                <span>
                  {t(
                    isDuesCategory(it.rows[0].category) || it.rows[0].dues_group
                      ? "crew.finGroupOf"
                      : "crew.finGroupOfN",
                    { n: it.rows.length },
                  )}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 sm:contents">
              {/* 잔액은 적지 않는다 — 회차 행들 사이에 다른 거래가 끼어 있을 수 있어
                  (회원 한 명씩 월회비→회차비 순으로 확정하면 실제로 그렇다) 한 줄에
                  걸어 둘 "이 시점의 잔액"이라는 게 없다. 낱개로 펴면 행마다 보인다. */}
              <span className="text-right sm:block">
                <span
                  className={`tabular block text-sm font-bold ${
                    it.rows[0].kind === "income" ? "text-success" : ""
                  }`}
                >
                  {it.rows[0].kind === "income" ? "+" : "−"}
                  {won(it.amount)}
                </span>
                <span className="block text-[11px] text-[#777]">{t("crew.finGroupNoBalance")}</span>
              </span>
              <span aria-hidden className="hidden text-right text-[11px] text-[#666] sm:block">
                ›
              </span>
            </span>
          </button>
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
