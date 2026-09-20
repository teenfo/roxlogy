"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { CrewLedgerDelete, CrewLedgerForm, type LedgerEntry } from "@/components/crew-ledger-form";
import { CrewLedgerSettle } from "@/components/crew-ledger-settle";
import { RoxDialog } from "@/components/rox/dialog";
import { categoryDictKey, isDuesCategory } from "@/lib/ledger-category";
import { won } from "@/lib/won";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, Choice, DataTable, Empty, Find, Hint, Panel } from "@/components/rox/ui";

/** 러닝 잔액까지 붙인 장부 행 */
export type LedgerTableRow = LedgerEntry & {
  /** 이 거래까지 반영된 장부 잔액 — 서버가 전체 거래 기준으로 계산해 온다 */
  balance: number;
  /** 회비 확정으로 생긴 행의 회차 키 (마이그레이션 108). 손으로 적은 거래는 null */
  dues_group: string | null;
};

/** ⋯ 행 메뉴 — 바깥을 덮는 버튼으로 바깥 클릭을 받는다(document 리스너 없이). 시안에 없는 최소 규칙 */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <span className="rx-row-menu">
      <Button variant="ghost" size="sm" type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((p) => !p)}>
        <MoreHorizontal size={16} />
      </Button>
      {open && (
        <>
          <button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)} className="rx-row-menu-scrim" />
          <span className="rx-row-menu-list" onClick={() => setOpen(false)}>
            {children}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * 수입·지출 장부 표 — 시안 finance.tsx 의 "거래 장부" Panel 그대로 (PORT_PLAN §3-e):
 * Panel(action N개 항목)[ .rx-toolbar(Find · Choice 전체/수입/지출) · DataTable[기준일 · 거래 내용 · 금액] ·
 * Empty · .rx-finance-ledger-total · Hint ]. 금액 아래 러닝 잔액, 회비 묶음 행, ⋯ 행 메뉴는 우리 것(§4).
 *
 * 잔액은 필터와 무관하게 전체 거래 기준이라 필터를 걸어도 값이 흔들리지 않는다(서버가 계산해 `balance` 로 넘겨준다).
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
  /** 세부 내역을 연 묶음의 키 */
  const [openKey, setOpenKey] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (!q || r.title.toLowerCase().includes(q) || (r.memo ?? "").toLowerCase().includes(q)),
  );

  // 합계는 달 전체 기준을 유지한다 — 필터를 걸었다고 이 달 수입이 바뀌면 다른 숫자다
  const income = rows.filter((r) => r.kind === "income").reduce((a, r) => a + r.amount, 0);
  const expense = rows.filter((r) => r.kind === "expense").reduce((a, r) => a + r.amount, 0);
  const net = income - expense;

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  const fullDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });

  /** 묶는 단위는 **분류 + 날짜**다(같은 날 같은 분류만 접는다 — 날짜를 옮기면 그냥 틀린 값이다). */
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

  const groupTitle = (g: Extract<Item, { type: "group" }>) => {
    const head = g.rows[0];
    if (head.category) return t(categoryDictKey(head.category));
    return head.title.split(" — ")[0] || head.title;
  };
  const openGroup = openKey
    ? (items.find((i) => i.type === "group" && i.key === openKey) as Extract<Item, { type: "group" }> | undefined)
    : undefined;

  const kindChip = (k: "income" | "expense") => (
    <Chip tone={k === "income" ? "blue" : "yellow"}>{t(k === "income" ? "crew.finKindIncome" : "crew.finKindExpense")}</Chip>
  );
  const settledChip = (r: LedgerTableRow) =>
    isStaff && !closed ? (
      <CrewLedgerSettle
        id={r.id}
        entryDate={r.entry_date}
        settledOn={r.settled_on}
        label={r.settled_on ? t("crew.finSettledOn", { date: shortDate(r.settled_on) }) : null}
      />
    ) : r.settled_on ? (
      <Chip tone="green">{t("crew.finSettledOn", { date: shortDate(r.settled_on) })}</Chip>
    ) : (
      <Chip>{t("crew.finUnsettledBadge")}</Chip>
    );

  const tableRows = items.map((it) =>
    it.type === "group"
      ? [
          <span key="d" className="rx-finance-date">
            {it.date.slice(5).replace("-", ".")}
          </span>,
          <div key="e" className="rx-finance-entry">
            <b>{groupTitle(it)}</b>
            <div>
              {kindChip(it.rows[0].kind)}
              <span>
                {t(
                  isDuesCategory(it.rows[0].category) || it.rows[0].dues_group ? "crew.finGroupOf" : "crew.finGroupOfN",
                  { n: it.rows.length },
                )}
              </span>
              <Button variant="ghost" size="sm" type="button" onClick={() => setOpenKey(it.key)} aria-label={t("crew.finGroupOpen", { title: groupTitle(it) })}>
                ›
              </Button>
            </div>
          </div>,
          <strong key="a" className={it.rows[0].kind === "income" ? "rx-income" : "rx-expense"}>
            {it.rows[0].kind === "income" ? "+" : "−"}
            {won(it.amount)}
            <small className="rx-block rx-muted">{t("crew.finGroupNoBalance")}</small>
          </strong>,
        ]
      : [
          <span key="d" className="rx-finance-date">
            {it.row.entry_date.slice(5).replace("-", ".")}
          </span>,
          <div key="e" className="rx-finance-entry">
            <b>{it.row.source === "dues" ? t("crew.duesEntry", { detail: it.row.title }) : it.row.title}</b>
            <div>
              {kindChip(it.row.kind)}
              <span>
                {it.row.category
                  ? t(categoryDictKey(it.row.category))
                  : it.row.source === "dues"
                    ? t("crew.finBadgeDues")
                    : t("crew.finCatNone")}
              </span>
              {it.row.method && <span>{t(`crew.finMethod.${it.row.method}` as DictKey)}</span>}
              {settledChip(it.row)}
            </div>
            {it.row.memo && <p>{it.row.memo}</p>}
          </div>,
          <span key="a" className="rx-actions" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
            <strong className={it.row.kind === "income" ? "rx-income" : "rx-expense"}>
              {it.row.kind === "income" ? "+" : "−"}
              {won(it.row.amount)}
              <small className="rx-block rx-muted">{won(it.row.balance)}</small>
            </strong>
            {isStaff && !closed && (
              <RowMenu label={t("crew.finRowMenu", { title: it.row.title })}>
                <CrewLedgerForm crewId={crewId} today={today} entry={it.row} trigger="menu" />
                <CrewLedgerDelete id={it.row.id} />
              </RowMenu>
            )}
          </span>,
        ],
  );

  return (
    <Panel title={t("crew.finLedgerTitle")} action={<span className="rx-muted">{t("crew.finItemsN", { n: shown.length })}</span>}>
      <RoxDialog
        open={!!openGroup}
        onOpenChange={(v) => !v && setOpenKey(null)}
        title={openGroup ? groupTitle(openGroup) : ""}
        description={
          openGroup
            ? `${fullDate(openGroup.date)} · ${t(
                isDuesCategory(openGroup.rows[0].category) || openGroup.rows[0].dues_group
                  ? "crew.finGroupOf"
                  : "crew.finGroupOfN",
                { n: openGroup.rows.length },
              )}`
            : undefined
        }
      >
        {openGroup && (
          <DataTable
            headers={[t("crew.finColDesc"), t("crew.finSettledLabel"), t("crew.finAmount")]}
            rows={openGroup.rows.map((r) => [
              <span key="t">{r.title.includes(" — ") ? r.title.split(" — ").slice(1).join(" — ") : r.title}</span>,
              <span key="s">{settledChip(r)}</span>,
              <span key="a" className="rx-actions" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                <strong className="rx-number">{won(r.amount)}</strong>
                {isStaff && !closed && (
                  <>
                    <CrewLedgerForm crewId={crewId} today={today} entry={r} trigger="icon" />
                    <CrewLedgerDelete id={r.id} />
                  </>
                )}
              </span>,
            ])}
          />
        )}
      </RoxDialog>

      <div className="rx-toolbar">
        <Find value={query} onChange={setQuery} placeholder={t("crew.finSearch")} />
        <div className="rx-actions">
          {hasGroups && (
            <label className="rx-check" style={{ margin: 0 }}>
              <Checkbox checked={grouped} onCheckedChange={(v) => setGrouped(v === true)} />
              {t("crew.finGroupDues")}
            </label>
          )}
          <Choice
            label={t("crew.finKindAll")}
            value={kind}
            onChange={(v) => setKind(v as typeof kind)}
            options={[
              ["all", t("crew.finKindAll")],
              ["income", t("crew.finKindIncome")],
              ["expense", t("crew.finKindExpense")],
            ]}
          />
        </div>
      </div>
      {tableRows.length ? (
        <DataTable headers={[t("crew.finColDate"), t("crew.finColDesc"), t("crew.finAmount")]} rows={tableRows} />
      ) : (
        <Empty title={t(rows.length ? "crew.finFilterEmpty" : "crew.finEmpty")} description={t("crew.finSearch")} />
      )}
      {rows.length > 0 && (
        <div className="rx-finance-ledger-total">
          <span>{t("crew.finLedgerTotal", { period: monthLabel })}</span>
          <strong className={net >= 0 ? "rx-income" : "rx-expense"}>
            {net >= 0 ? "+" : "−"}
            {won(net)}
          </strong>
        </div>
      )}
      <Hint>
        {t("crew.finKindIncome")} +{won(income)} · {t("crew.finKindExpense")} −{won(expense)} · {t("crew.finMonthEndBalance")}{" "}
        {won(rows[0]?.balance ?? 0)}
      </Hint>
    </Panel>
  );
}
