"use client";

import { useRef } from "react";
import { useI18n } from "@/components/i18n-provider";

export type UnpaidCharge = {
  charge_id: string;
  user_id: string;
  name: string;
  period: string;
  kind: "monthly" | "session" | "custom";
  label: string;
  amount: number;
  status: "pending" | "reported";
};

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

/** 미납 회비 타일 — 누르면 내역을 모달로 연다.
 *  기간 무관 전체 미납이라 회계 탭(월별 보드)에서는 한 번에 볼 수 없다.
 *  native <dialog> 를 써서 포커스 가둠·ESC 닫기를 브라우저에 맡긴다. */
export function CrewUnpaidCard({
  amount,
  count,
  waived,
  charges,
  financeHref,
}: {
  amount: number;
  count: number;
  waived: number;
  charges: UnpaidCharge[];
  financeHref: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  const sub =
    t("crew.statUnpaidSub", { n: count }) +
    (waived > 0 ? ` · ${t("crew.statWaived", { amount: won(waived) })}` : "");

  // 사람별로 묶어 누가 얼마나 밀렸는지 먼저 보이게
  const byMember = new Map<string, UnpaidCharge[]>();
  for (const c of charges) {
    const arr = byMember.get(c.user_id) ?? [];
    arr.push(c);
    byMember.set(c.user_id, arr);
  }

  const tile = (
    <>
      <p className="text-xs text-muted">{t("crew.statUnpaid")}</p>
      <p
        className={`mt-1 font-mono text-lg font-bold ${amount > 0 ? "text-red-400" : ""}`}
      >
        {won(amount)}
      </p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </>
  );

  if (!charges.length) {
    return <div className="rounded-md bg-surface px-4 py-3">{tile}</div>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="rounded-md bg-surface px-4 py-3 text-left ring-accent/40 hover:ring-1"
      >
        {tile}
        <span className="mt-1 block text-xs text-accent">
          {t("crew.unpaidOpen")}
        </span>
      </button>

      <dialog
        ref={ref}
        onClick={(e) => {
          // 바깥(백드롭) 클릭으로 닫기
          if (e.target === ref.current) ref.current?.close();
        }}
        className="w-[min(32rem,92vw)] rounded-md bg-surface p-0 text-foreground backdrop:bg-background/70"
      >
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold">{t("crew.unpaidTitle")}</h3>
            <span className="font-mono text-sm font-bold text-red-400">
              {won(amount)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">{t("crew.unpaidHint")}</p>

          <ul className="mt-3 flex flex-col gap-2">
            {[...byMember.entries()].map(([uid, list]) => {
              const sum = list.reduce((a, c) => a + c.amount, 0);
              return (
                <li key={uid} className="rounded-md bg-background px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {list[0].name}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-accent">
                      {won(sum)}
                    </span>
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {list.map((c) => (
                      <li
                        key={c.charge_id}
                        className="flex items-baseline gap-2 text-xs text-muted"
                      >
                        <span className="shrink-0 font-mono">{c.period}</span>
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {c.status === "reported" && (
                          <span className="shrink-0 text-accent">
                            {t("crew.duesReported")}
                          </span>
                        )}
                        <span className="shrink-0 font-mono">{won(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3">
            <a
              href={financeHref}
              className="text-xs text-accent hover:underline"
            >
              {t("crew.unpaidGoFinance")}
            </a>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="rounded-md bg-background px-4 py-1.5 text-xs font-semibold"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
