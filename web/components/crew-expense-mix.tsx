import { getT } from "@/lib/i18n";
import { EXPENSE_BAR_COLORS, categoryDictKey, LEDGER_CATEGORIES } from "@/lib/ledger-category";
import { won } from "@/lib/won";
import { Panel } from "@/components/rox/ui";

/** 지출 구성 색 — 시안 SpendingMix 의 5색(CSS 변수 대신 hex, 범례 사각과 바가 같은 값) */
const TONES: Record<string, string> = {
  venue: "#8297cf",
  snack: "#d2bd44",
  gear: "#63a090",
  race: "#bb7055",
  other: "#69727f",
  none: "#b7c0c9",
};

/**
 * 이 달 지출 구성 — 시안 finance.tsx SpendingMix 그대로 (Panel.rx-finance-mix · .rx-finance-mix-bar · ul).
 *
 * 분류별 합계를 한 줄 바로 쌓고 범례에 이름·금액을 적는다 — 색만으로 구분하지 않는다.
 * 순서는 `LEDGER_CATEGORIES` 고정이라 달이 바뀌어도 같은 분류가 같은 색을 쓴다.
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
    <Panel title={t("crew.finExpenseMix", { period: periodLabel })} className="rx-finance-mix">
      {total > 0 ? (
        <>
          <div className="rx-finance-mix-bar" aria-hidden="true">
            {parts.map((p) => (
              <span
                key={p.key}
                style={{
                  width: `${(p.amount / total) * 100}%`,
                  background: TONES[p.key] ?? EXPENSE_BAR_COLORS[p.key],
                }}
              />
            ))}
          </div>
          <ul>
            {parts.map((p) => (
              <li key={p.key}>
                <span>
                  <i style={{ background: TONES[p.key] ?? EXPENSE_BAR_COLORS[p.key] }} />
                  {p.key === "none" ? t("crew.finCatNone") : t(categoryDictKey(p.key))}
                </span>
                <strong>{won(p.amount)}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t("crew.finEmpty")}</p>
      )}
    </Panel>
  );
}
