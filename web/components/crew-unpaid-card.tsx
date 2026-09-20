"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { won } from "@/lib/won";
import { Button } from "@/components/ui/button";
import { RoxDialog } from "@/components/rox/dialog";
import { Chip, DataTable, Go, Hint } from "@/components/rox/ui";

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

/**
 * 미납 회비 타일 — 시안 Stats 의 한 칸(.rx-stat) 모양. 누르면 내역을 RoxDialog 로 연다.
 * 기간 무관 전체 미납이라 회계 탭(월별 보드)에서는 한 번에 볼 수 없다.
 */
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
  const rows = [...byMember.values()].flatMap((list) =>
    list.map((c, i) => [
      <span key="n">{i === 0 ? <b>{c.name}</b> : ""}</span>,
      <span key="l">
        <span className="rx-muted">{c.period}</span> {c.label}
        {c.status === "reported" && (
          <>
            {" "}
            <Chip tone="yellow">{t("crew.duesReported")}</Chip>
          </>
        )}
      </span>,
      <strong key="a" className="rx-number">
        {won(c.amount)}
      </strong>,
    ]),
  );

  return (
    <>
      <div
        className="rx-stat"
        role={charges.length ? "button" : undefined}
        tabIndex={charges.length ? 0 : undefined}
        onClick={() => charges.length && setOpen(true)}
        onKeyDown={(e) => {
          if (charges.length && (e.key === "Enter" || e.key === " ")) setOpen(true);
        }}
        style={charges.length ? { cursor: "pointer" } : undefined}
      >
        <span>{t("crew.statUnpaid")}</span>
        <strong className={amount > 0 ? "rx-expense" : ""}>{won(amount)}</strong>
        <p>
          {sub}
          {charges.length > 0 && ` · ${t("crew.unpaidOpen")}`}
        </p>
      </div>

      <RoxDialog
        open={open}
        onOpenChange={setOpen}
        title={t("crew.unpaidTitle")}
        description={t("crew.unpaidHint")}
      >
        <div className="rx-actions">
          <Chip tone="red">{won(amount)}</Chip>
        </div>
        <DataTable headers={[t("crew.colMember"), t("crew.finColDesc"), t("crew.finAmount")]} rows={rows} />
        <div className="rx-actions" style={{ marginTop: 16 }}>
          <Go href={financeHref}>{t("crew.unpaidGoFinance")}</Go>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            {t("common.close")}
          </Button>
        </div>
        <Hint>{t("crew.unpaidHint")}</Hint>
      </RoxDialog>
    </>
  );
}
