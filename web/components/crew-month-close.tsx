"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/**
 * 월 마감 — 그 달의 회비 청구와 장부를 잠근다.
 *
 * 마감하면 청구 확정·면제·대사도, 장부 추가·수정·삭제도 막힌다(DB 트리거가
 * 강제한다 — 화면에서 버튼을 숨기는 것과 별개로 서버에서 거부된다).
 * 통장 반영일만은 열어 둔다: 9월 지출이 10월 통장에 찍히는 일이 흔해서다.
 */
export function CrewMonthClose({
  crewId,
  period,
  periodLabel,
  closedOn,
  canEdit,
  unpaidCount,
}: {
  crewId: string;
  period: string;
  periodLabel: string;
  /** 마감된 날 (ISO). null 이면 열려 있다 */
  closedOn: string | null;
  /** 운영진만 잠그고 풀 수 있다 */
  canEdit: boolean;
  /** 마감 전 경고용 — 아직 안 받은 청구 건수 */
  unpaidCount: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function close() {
    const warn = unpaidCount
      ? `${t("crew.finCloseUnpaid", { n: unpaidCount })}\n\n`
      : "";
    if (!window.confirm(warn + t("crew.finCloseConfirm", { period: periodLabel })))
      return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("crew_month_close")
      .insert({ crew_id: crewId, period, closed_by: user?.id });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function reopen() {
    if (!window.confirm(t("crew.finReopenConfirm", { period: periodLabel })))
      return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient()
      .from("crew_month_close")
      .delete()
      .eq("crew_id", crewId)
      .eq("period", period);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      {closedOn && (
        <span className="flex h-9 shrink-0 items-center rounded-[10px] bg-label-bg px-2.5 text-xs font-bold text-label">
          🔒 {t("crew.finClosedBadge")}
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={closedOn ? reopen : close}
          disabled={busy}
          className="flex h-9 shrink-0 items-center rounded-[10px] border border-line-strong bg-control px-3 text-sm font-semibold transition-colors hover:border-line-strong disabled:opacity-40"
        >
          {busy ? "…" : closedOn ? t("crew.finReopen") : t("crew.finClose")}
        </button>
      )}
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
