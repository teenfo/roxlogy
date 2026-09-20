"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


/**
 * 장부 한 줄의 통장 반영 표시 — 시안 장부 행의 "미정산" Chip 자리. 운영진만 누를 수 있다.
 *
 * 등록할 때 반영일을 아는 경우는 드물다(카드는 며칠 뒤에 빠진다). 그래서
 * 나중에 통장을 보고 표시할 수 있어야 한다. 기본값은 그 거래일 — 현금·이체는
 * 대개 그날 찍히고, 다르면 날짜를 고쳐 넣는다.
 */
export function CrewLedgerSettle({
  id,
  entryDate,
  settledOn,
  label,
}: {
  id: string;
  entryDate: string;
  settledOn: string | null;
  /** 반영된 날짜 배지 문구 (서버에서 로케일로 포맷) */
  label: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(settledOn ?? entryDate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(value: string | null) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("crew_ledger").update({ settled_on: value }).eq("id", id);
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  if (settledOn) {
    return (
      <button
        type="button"
        onClick={() => set(null)}
        disabled={busy}
        title={t("crew.finUnsettleHint")}
        className="rx-chip green"
      >
        {label}
      </button>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rx-chip">
        {t("crew.finUnsettledBadge")}
      </button>
    );
  }

  return (
    <span className="rx-actions">
      <Input
        type="date"
        aria-label={t("crew.finSettledLabel")}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={{ width: 150, height: 30 }}
      />
      <Button size="sm" className="rx-primary" type="button" onClick={() => set(date || entryDate)} disabled={busy}>
        {t("crew.finSettle")}
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </span>
  );
}

/** 이 달 미반영분을 한 번에 — 거래일 그대로 통장 반영일로 넣는다 */
export function CrewLedgerSettleMonth({
  crewId,
  from,
  to,
  count,
}: {
  crewId: string;
  from: string;
  to: string;
  count: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!window.confirm(t("crew.finSettleAllConfirm", { n: count }))) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    // 거래일을 반영일로 그대로 넣는다. 한 건씩 값이 달라 일괄 update 로는
    // 안 되므로, 대상만 먼저 읽고 각자의 entry_date 로 채운다.
    const { data, error } = await supabase
      .from("crew_ledger")
      .select("id, entry_date")
      .eq("crew_id", crewId)
      .is("settled_on", null)
      .gte("entry_date", from)
      .lte("entry_date", to);
    if (error) {
      setBusy(false);
      return setErr(error.message);
    }
    for (const r of (data ?? []) as { id: string; entry_date: string }[]) {
      const { error: e2 } = await supabase
        .from("crew_ledger")
        .update({ settled_on: r.entry_date })
        .eq("id", r.id);
      if (e2) {
        setBusy(false);
        setErr(e2.message);
        router.refresh();
        return;
      }
    }
    setBusy(false);
    router.refresh();
  }

  if (count === 0) return null;

  return (
    <>
      <Button variant="outline" className="rx-wide" type="button" onClick={run} disabled={busy}>
        {t("crew.finSettleAll", { n: count })}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </>
  );
}
