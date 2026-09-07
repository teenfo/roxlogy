"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { tierBadgeClass } from "@/lib/crew-role";
import { duesErrText } from "@/lib/dues-error";

const badge = (cls: string) =>
  `shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`;
const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

export type ChargeStatus = "pending" | "reported" | "confirmed";

/** 본인 회비 청구 1건 (my_dues_charges) */
export type MyCharge = {
  charge_id: string;
  kind: "monthly" | "session" | "custom";
  label: string;
  amount: number;
  status: ChargeStatus;
  period: string;
  created_at: string;
};

/** 내 회비 — 소개 탭. 미납 청구를 건별로 보여주고 납부 신고를 받는다.
 *  월회비와 회차비가 섞이므로 합계를 먼저 보여준다. */
export function CrewDuesSelfReport({ charges }: { charges: MyCharge[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function report(id: string, on: boolean) {
    setBusy(id);
    setErr(null);
    const { error } = await createClient().rpc("report_dues_charge", {
      p_charge: id,
      p_on: on,
    });
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  const open = charges.filter((c) => c.status !== "confirmed");
  const outstanding = open.reduce((a, c) => a + c.amount, 0);

  if (!charges.length) return null;

  return (
    <div className="rounded-md bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-muted">{t("crew.duesMyTitle")}</span>
        {outstanding > 0 ? (
          <span className="font-mono text-sm font-bold text-accent">
            {won(outstanding)}
          </span>
        ) : (
          <span className={badge("bg-track/15 text-track")}>
            ✓ {t("crew.duesAllPaid")}
          </span>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}

      <ul className="mt-2 flex flex-col gap-1">
        {charges.slice(0, 12).map((c) => (
          <li
            key={c.charge_id}
            className="flex flex-wrap items-center gap-2 rounded-md bg-background px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-xs">
              {c.label}
              {c.kind === "session" && (
                <span className="ml-1.5 text-[10px] text-muted">
                  {t("crew.duesKindSession")}
                </span>
              )}
            </span>
            <span className="font-mono text-xs">{won(c.amount)}</span>
            {c.status === "confirmed" ? (
              <span className={badge("bg-track/15 text-track")}>
                ✓ {t("crew.duesConfirmed")}
              </span>
            ) : c.status === "reported" ? (
              <>
                <span className={badge("bg-accent/15 text-accent")}>
                  {t("crew.duesReported")}
                </span>
                <button
                  type="button"
                  onClick={() => report(c.charge_id, false)}
                  disabled={busy != null}
                  className="text-[11px] text-muted hover:text-red-400 disabled:opacity-50"
                >
                  {t("crew.duesCancelReport")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => report(c.charge_id, true)}
                disabled={busy != null}
                className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-background hover:brightness-110 disabled:opacity-40"
              >
                {t("crew.duesReport")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 회비 보드 1행 = 청구 1건 (crew_dues_board) */
export type BoardCharge = {
  charge_id: string;
  user_id: string;
  display_name: string;
  /** 운영진에게만 내려온다 — RPC 가 게이트 */
  email: string | null;
  tier_name: string | null;
  tier_color: string | null;
  kind: "monthly" | "session" | "custom";
  label: string;
  amount: number;
  status: ChargeStatus;
  event_at: string | null;
};

/** 회비 확정 보드 — 회계 탭의 운영진 전용 섹션.
 *  청구를 회원별로 묶어 월회비·회차비를 함께 보여주고 건별로 확정한다.
 *  확정하면 회계에 수입이 기록되고, 해제하면 그 회계 행도 지워진다. */
export function CrewDuesMatrix({
  crewId,
  period,
  charges,
}: {
  crewId: string;
  period: string;
  charges: BoardCharge[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call(key: string, fn: string, args: Record<string, unknown>) {
    setBusy(key);
    setErr(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  const generate = () =>
    call("gen", "generate_monthly_charges", { p_crew: crewId, p_period: period });

  // 회원별로 묶는다 — 보드는 이미 이름·종류 순으로 정렬돼 온다.
  const byMember = new Map<string, BoardCharge[]>();
  for (const c of charges) {
    const arr = byMember.get(c.user_id) ?? [];
    arr.push(c);
    byMember.set(c.user_id, arr);
  }

  const unpaid = charges
    .filter((c) => c.status !== "confirmed")
    .reduce((a, c) => a + c.amount, 0);
  const paid = charges
    .filter((c) => c.status === "confirmed")
    .reduce((a, c) => a + c.amount, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted">
          {t("crew.duesTotals", { paid: won(paid), unpaid: won(unpaid) })}
        </p>
        <button
          type="button"
          onClick={generate}
          disabled={busy != null}
          className="ml-auto rounded-md bg-surface px-3 py-1.5 text-xs font-semibold hover:text-accent disabled:opacity-50"
        >
          {t("crew.duesGenerate")}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}

      {!charges.length ? (
        <p className="rounded-md bg-surface px-4 py-8 text-center text-xs text-muted">
          {t("crew.duesNoCharges")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {[...byMember.entries()].map(([uid, list]) => {
            const head = list[0];
            const memberUnpaid = list
              .filter((c) => c.status !== "confirmed")
              .reduce((a, c) => a + c.amount, 0);
            return (
              <li key={uid} className="rounded-md bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">
                      {head.display_name}
                    </span>
                    {head.email && (
                      <span className="truncate text-[11px] font-normal text-muted">
                        {head.email}
                      </span>
                    )}
                  </span>
                  {head.tier_name && (
                    <span
                      className={`${badge(tierBadgeClass(head.tier_color))} font-semibold`}
                    >
                      {head.tier_name}
                    </span>
                  )}
                  <span
                    className={`ml-auto font-mono text-xs ${
                      memberUnpaid > 0 ? "text-accent" : "text-muted"
                    }`}
                  >
                    {memberUnpaid > 0
                      ? t("crew.duesOutstanding", { amount: won(memberUnpaid) })
                      : `✓ ${t("crew.duesConfirmed")}`}
                  </span>
                </div>

                <ul className="mt-2 flex flex-col gap-1">
                  {list.map((c) => (
                    <li
                      key={c.charge_id}
                      className="flex flex-wrap items-center gap-2 rounded-md bg-background px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {c.label}
                        <span className="ml-1.5 text-[10px] text-muted">
                          {c.kind === "monthly"
                            ? t("crew.duesKindMonthly")
                            : c.kind === "session"
                              ? t("crew.duesKindSession")
                              : t("crew.duesKindCustom")}
                        </span>
                      </span>
                      <span className="font-mono text-xs">{won(c.amount)}</span>
                      {c.status === "reported" && (
                        <span className={badge("bg-accent/15 text-accent")}>
                          {t("crew.duesReported")}
                        </span>
                      )}
                      {c.status === "confirmed" ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(t("crew.duesUncheckConfirm"))) return;
                            call(c.charge_id, "unconfirm_dues_charge", {
                              p_charge: c.charge_id,
                            });
                          }}
                          disabled={busy != null}
                          className={`${badge("bg-track/15 text-track")} hover:brightness-125 disabled:opacity-50`}
                        >
                          ✓ {t("crew.duesConfirmed")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            call(c.charge_id, "confirm_dues_charge", {
                              p_charge: c.charge_id,
                            })
                          }
                          disabled={busy != null}
                          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-background hover:brightness-110 disabled:opacity-40"
                        >
                          {t("crew.duesConfirm")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
