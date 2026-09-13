"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Dialog } from "@/components/ui/dialog";

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
 *
 *  예전엔 native <dialog>.showModal() 을 썼는데 화면 좌상단에 붙어 떴다 —
 *  브라우저가 dialog 를 가운데 두는 건 `margin: auto` 인데 Tailwind preflight 가
 *  모든 요소의 margin 을 0 으로 지워 버리기 때문이다(2026-09-14). 다른 모달과 같은
 *  공용 Dialog 로 바꿔 가운데 정렬·포커스 가둠·ESC·배경 스크롤 잠금을 한 곳에서 얻는다. */
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
  const [open, setOpen] = useState(false);

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
        onClick={() => setOpen(true)}
        className="rounded-md bg-surface px-4 py-3 text-left ring-accent/40 hover:ring-1"
      >
        {tile}
        <span className="mt-1 block text-xs text-accent">
          {t("crew.unpaidOpen")}
        </span>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={t("crew.unpaidTitle")}
        closeLabel={t("common.close")}
        variant="center"
        panelClassName="max-w-lg rounded-md bg-surface text-foreground"
      >
        <div className="px-5 py-4">
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
              onClick={() => setOpen(false)}
              className="rounded-md bg-background px-4 py-1.5 text-xs font-semibold"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
