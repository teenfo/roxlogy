import { getT } from "@/lib/i18n";
import {
  EXPENSE_BAR_COLORS,
  categoryDictKey,
  LEDGER_CATEGORIES,
} from "@/lib/ledger-category";

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

/**
 * 이 달 지출 구성 (디자인 시안 §2-b).
 *
 * 분류별 합계를 한 줄 바로 쌓고 범례에 이름·금액을 적는다 — 색만으로 구분하지 않는다.
 * 순서는 `LEDGER_CATEGORIES` 고정이라 달이 바뀌어도 같은 분류가 같은 색을 쓴다.
 * 지출이 없으면 카드 자체를 그리지 않는다(빈 바는 정보가 없다).
 */
export async function CrewExpenseMix({
  rows,
  periodLabel,
}: {
  rows: { kind: string; amount: number; category: string | null }[];
  periodLabel: string;
}) {
  const { t } = await getT();
  const expenses = rows.filter((r) => r.kind === "expense");
  const total = expenses.reduce((a, r) => a + r.amount, 0);
  if (total === 0) return null;

  const sums = new Map<string, number>();
  for (const r of expenses) {
    const k = r.category ?? "none";
    sums.set(k, (sums.get(k) ?? 0) + r.amount);
  }
  // 분류 순서를 고정하고, 미분류는 늘 맨 뒤
  const parts = [...LEDGER_CATEGORIES.expense, "none"]
    .map((k) => ({ key: k, amount: sums.get(k) ?? 0 }))
    .filter((p) => p.amount > 0);

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-card px-[18px] py-3.5">
      <p className="text-[11px] font-extrabold tracking-[0.08em] text-muted">
        {t("crew.finExpenseMix", { period: periodLabel })}
      </p>
      <span className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-inset">
        {parts.map((p) => (
          <span
            key={p.key}
            className="h-full"
            style={{
              width: `${(p.amount / total) * 100}%`,
              background: EXPENSE_BAR_COLORS[p.key],
            }}
          />
        ))}
      </span>
      <ul className="flex flex-col gap-1 text-xs">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: EXPENSE_BAR_COLORS[p.key] }}
            />
            <span className="min-w-0 truncate text-muted">
              {p.key === "none" ? t("crew.finCatNone") : t(categoryDictKey(p.key))}
            </span>
            <span className="tabular ml-auto shrink-0 font-semibold">{won(p.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
