"use client";

import { useId, useState, type ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";

/**
 * 차트 공통 틀 (UI 감사 2026-09-12 P1) — 차트를 그리기 전에 한 문장 결론을 먼저 주고,
 * 같은 데이터를 표로 볼 수 있는 토글을 붙인다. 차트 자체는 role="img" 로 묶어
 * 보조기술에는 요약 문장이 이름으로 읽히고, 내부 SVG 는 건너뛴다.
 */
export function ChartFrame({
  summary,
  columns,
  rows,
  children,
}: {
  /** 한 문장 요약 — 시각적으로도 보이고 차트의 접근 가능한 이름이 된다 */
  summary: string;
  columns: string[];
  rows: (string | number)[][];
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [table, setTable] = useState(false);
  const id = useId();
  return (
    <div>
      <div className="mb-2 flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sm text-foreground/85">{summary}</p>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => setTable((v) => !v)}
            aria-pressed={table}
            aria-controls={id}
            className="flex h-8 shrink-0 items-center rounded-lg border border-line-mid bg-control px-2.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
          >
            {table ? t("chart.showChart") : t("chart.showTable")}
          </button>
        )}
      </div>
      {table ? (
        <div id={id} className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-inset text-left text-xs text-muted">
                {columns.map((c, i) => (
                  <th key={i} scope="col" className="px-3 py-2 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line-soft last:border-b-0">
                  {r.map((v, j) => (
                    <td key={j} className={`px-3 py-1.5 ${j > 0 ? "tabular" : ""}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div id={id} role="img" aria-label={summary}>
          {children}
        </div>
      )}
    </div>
  );
}
