"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export type DuesPaymentStatus = "reported" | "confirmed" | null;

const badge = (cls: string) =>
  `shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`;

/** 회비 셀프 신고 — 소개 탭. 납부 후 멤버 본인이 "납부 완료 신고"를 누르면
 *  확인 대기 상태가 되고, 운영진이 입금 대조 후 확정한다. */
export function CrewDuesSelfReport({
  crewId,
  period,
  status,
}: {
  crewId: string;
  period: string; // YYYY-MM (이번 달)
  status: DuesPaymentStatus;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function report() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("crew_dues_payments").insert({
      crew_id: crewId,
      user_id: u.user.id,
      period,
      status: "reported",
      reported_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  async function cancelReport() {
    setBusy(true);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      await supabase
        .from("crew_dues_payments")
        .delete()
        .eq("crew_id", crewId)
        .eq("user_id", u.user.id)
        .eq("period", period)
        .eq("status", "reported");
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface px-4 py-3">
      <span className="text-sm text-muted">
        {t("crew.duesMyStatus", { period })}
      </span>
      {status === "confirmed" ? (
        <span className={badge("bg-track/15 text-track")}>
          ✓ {t("crew.duesConfirmed")}
        </span>
      ) : status === "reported" ? (
        <>
          <span className={badge("bg-accent/15 text-accent")}>
            {t("crew.duesReported")}
          </span>
          <button
            type="button"
            onClick={cancelReport}
            disabled={busy}
            className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
          >
            {t("crew.duesCancelReport")}
          </button>
        </>
      ) : (
        <>
          <span className={badge("bg-background text-muted")}>
            {t("crew.duesUnpaid")}
          </span>
          <button
            type="button"
            onClick={report}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110 disabled:opacity-40"
          >
            {t("crew.duesReport")}
          </button>
        </>
      )}
      {err && <p className="w-full text-xs text-red-400">{err}</p>}
    </div>
  );
}

export type DuesMatrixRow = {
  user_id: string;
  display_name: string;
  role: "owner" | "coach" | "member" | "associate";
  status: DuesPaymentStatus;
  amount: number | null;
};

/** 회비 납부 체크 매트릭스 — 회계 페이지의 운영진 전용 섹션.
 *  해당 월의 멤버별 납부 상태를 보여주고, 확인(금액 입력 시 회계 수입 자동
 *  기록)·체크·해제를 처리한다. 해제해도 회계 기록은 남는다. */
export function CrewDuesMatrix({
  crewId,
  period,
  rows,
}: {
  crewId: string;
  period: string; // YYYY-MM (회계 페이지의 현재 월)
  rows: DuesMatrixRow[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  async function confirm(userId: string) {
    const raw = (amounts[userId] ?? "").replace(/[^\d]/g, "");
    const amount = raw ? parseInt(raw, 10) : null;
    setBusy(userId);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_dues_paid", {
      p_crew: crewId,
      p_user: userId,
      p_period: period,
      p_amount: amount,
    });
    setBusy(null);
    if (error) setErr(error.message);
    else router.refresh();
  }

  async function uncheck(userId: string) {
    if (!window.confirm(t("crew.duesUncheckConfirm"))) return;
    setBusy(userId);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("crew_dues_payments")
      .delete()
      .eq("crew_id", crewId)
      .eq("user_id", userId)
      .eq("period", period);
    setBusy(null);
    if (error) setErr(error.message);
    else router.refresh();
  }

  const unpaidCount = rows.filter((r) => r.status !== "confirmed").length;
  const amountInput =
    "w-28 rounded-md border border-muted/30 bg-background px-2 py-1 text-xs outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        {t("crew.duesCheckHint", { n: unpaidCount })}
      </p>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li
            key={r.user_id}
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface px-3 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              {r.display_name}
            </span>
            {r.status === "confirmed" ? (
              <>
                <span className={badge("bg-track/15 text-track")}>
                  ✓ {t("crew.duesConfirmed")}
                </span>
                {r.amount != null && (
                  <span className="font-mono text-xs text-muted">
                    ₩{r.amount.toLocaleString("ko-KR")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => uncheck(r.user_id)}
                  disabled={busy != null}
                  className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
                >
                  {t("crew.duesUncheck")}
                </button>
              </>
            ) : (
              <>
                {r.status === "reported" && (
                  <span className={badge("bg-accent/15 text-accent")}>
                    {t("crew.duesReported")}
                  </span>
                )}
                <input
                  className={amountInput}
                  value={amounts[r.user_id] ?? ""}
                  onChange={(e) =>
                    setAmounts((m) => ({ ...m, [r.user_id]: e.target.value }))
                  }
                  placeholder={t("crew.duesAmountPh")}
                  inputMode="numeric"
                />
                <button
                  type="button"
                  onClick={() => confirm(r.user_id)}
                  disabled={busy != null}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110 disabled:opacity-40"
                >
                  {busy === r.user_id
                    ? "…"
                    : r.status === "reported"
                      ? t("crew.duesConfirmBtn")
                      : t("crew.duesMarkPaid")}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
