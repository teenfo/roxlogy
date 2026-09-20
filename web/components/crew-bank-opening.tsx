"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RoxDialog } from "@/components/rox/dialog";
import { Field } from "@/components/rox/ui";

/**
 * 통장 기초 잔액 — 시안 Finance BankSummary 의 "기초 잔액 설정" Dialog 그대로(RoxDialog). 운영진만.
 *
 * 통장 잔고를 계산하려면 시작점이 필요하다. 장부를 쓰기 시작한 시점의 통장
 * 잔액을 한 번 적어 두면, 이후로는 "통장에 찍힌" 거래만 더해 잔고가 따라간다.
 */
export function CrewBankOpening({
  crewId,
  openingBalance,
  openingOn,
}: {
  crewId: string;
  openingBalance: number;
  openingOn: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(openingBalance));
  const [on, setOn] = useState(openingOn ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replaceAll(",", ""));
    if (!Number.isFinite(amt)) return setErr(t("crew.finErrInput"));
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("crew_bank").upsert(
      {
        crew_id: crewId,
        opening_balance: Math.round(amt),
        opening_on: on || null,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      },
      { onConflict: "crew_id" },
    );
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" className="rx-wide" type="button" onClick={() => setOpen(true)}>
        {t("crew.finOpeningSet")}
      </Button>
      <RoxDialog
        open={open}
        onOpenChange={setOpen}
        title={t("crew.finOpeningSet")}
        description={t("crew.finOpeningEdit")}
      >
        <form onSubmit={save}>
          <Field label={`${t("crew.finOpening")} (₩)`}>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              required
            />
          </Field>
          <Field label={t("crew.finOpeningOn")}>
            <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
          {err && (
            <p role="alert" className="rx-error">
              {err}
            </p>
          )}
          <Button type="submit" className="rx-primary rx-wide" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      </RoxDialog>
    </>
  );
}
