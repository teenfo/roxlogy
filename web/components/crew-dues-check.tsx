"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Avatar, Card, Chip } from "@/components/ui/crew-ui";
import { tierBadgeClass } from "@/lib/crew-role";
import { duesErrText } from "@/lib/dues-error";

const badge = (cls: string) =>
  `shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`;
const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

export type ChargeStatus = "pending" | "reported" | "confirmed" | "waived";

/** 본인 회비 청구 1건 (my_dues_charges) */
export type MyCharge = {
  charge_id: string;
  kind: "monthly" | "session" | "custom";
  label: string;
  amount: number;
  status: ChargeStatus;
  period: string;
  created_at: string;
  waive_reason: string | null;
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

  // 면제된 건은 낼 돈이 아니다
  const open = charges.filter(
    (c) => c.status === "pending" || c.status === "reported",
  );
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
            className="flex flex-wrap items-center gap-2 rounded-lg bg-card px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-xs">
              {c.label}
              {c.kind === "session" && (
                <span className="ml-1.5 text-[10px] text-muted">
                  {t("crew.duesKindSession")}
                </span>
              )}
            </span>
            <span
                        className={`tabular text-xs font-bold ${c.status === "waived" ? "text-muted line-through" : ""}`}
                      >
                        {won(c.amount)}
                      </span>
            {c.status === "waived" ? (
              <span className={badge("bg-track/15 text-track")}>
                {t("crew.duesWaived")}
                {c.waive_reason ? ` · ${c.waive_reason}` : ""}
              </span>
            ) : c.status === "confirmed" ? (
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
  waive_reason: string | null;
};

/** 회비 확정 보드 — 회계 탭의 운영진 전용 섹션.
 *  청구를 회원별로 묶어 월회비·회차비를 함께 보여주고 건별로 확정한다.
 *  확정하면 회계에 수입이 기록되고, 해제하면 그 회계 행도 지워진다. */
export function CrewDuesMatrix({
  crewId,
  period,
  periodLabel,
  charges,
  locked = false,
}: {
  crewId: string;
  period: string;
  /** 버튼이 어느 달을 대상으로 하는지 분명히 하기 위한 표시용 라벨 */
  periodLabel: string;
  charges: BoardCharge[];
  /** 마감된 달 — 확정·면제·대사를 막는다 (DB 트리거도 같이 막는다) */
  locked?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** 펼친 회원. 기본은 전부 접힘 — 회원이 많으면 한 화면에 안 들어온다. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  /** 상태 필터 — 미납만 추려 보는 게 이 화면의 주 용도다 */
  const [filter, setFilter] = useState<"all" | "unpaid" | "settled" | "waived">(
    "all",
  );
  const toggle = (uid: string) =>
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });

  async function call(key: string, fn: string, args: Record<string, unknown>) {
    setBusy(key);
    setErr(null);
    setNote(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  /** 면제 — 사유를 남긴다(취소하면 아무 일도 안 함). 면제는 미납도 수입도
   *  아니라서 회계에는 아무것도 기록하지 않는다. */
  function waive(id: string) {
    const reason = window.prompt(t("crew.duesWaivePrompt"), "");
    if (reason === null) return;
    call(id, "waive_dues_charge", { p_charge: id, p_reason: reason });
  }

  /** 대사(reconcile)는 그 달을 현재 등급·요금·출석에 맞추는 동작이라 결과를
   *  반드시 알린다. 0건일 때 아무 표시가 없으면 버튼이 안 먹는 것처럼 보인다.
   *  확정·신고된 청구는 어느 경로로도 건드리지 않고 locked 로만 보고된다. */
  async function reconcile(rpc: string, kindLabel: string) {
    setBusy(rpc);
    setErr(null);
    setNote(null);
    const { data, error } = await createClient().rpc(rpc, {
      p_crew: crewId,
      p_period: period,
    });
    setBusy(null);
    if (error) return setErr(duesErrText(t, error.message));
    const r = (data ?? {}) as {
      created?: number;
      updated?: number;
      removed?: number;
      locked?: number;
    };
    const parts: string[] = [];
    if (r.created) parts.push(t("crew.duesGenCreated", { n: r.created }));
    if (r.updated) parts.push(t("crew.duesGenUpdated", { n: r.updated }));
    if (r.removed) parts.push(t("crew.duesGenRemoved", { n: r.removed }));
    const head = `${periodLabel} ${kindLabel} — `;
    const body = parts.length ? parts.join(" · ") : t("crew.duesGenNone");
    const tail = r.locked ? ` (${t("crew.duesGenLocked", { n: r.locked })})` : "";
    setNote(head + body + tail);
    router.refresh();
  }

  // 회원별로 묶는다 — 보드는 이미 이름·종류 순으로 정렬돼 온다.
  const byMember = new Map<string, BoardCharge[]>();
  for (const c of charges) {
    const arr = byMember.get(c.user_id) ?? [];
    arr.push(c);
    byMember.set(c.user_id, arr);
  }

  const sum = (f: (c: BoardCharge) => boolean) =>
    charges.filter(f).reduce((a, c) => a + c.amount, 0);
  // 면제는 미납도 수입도 아니다 — 두 합계 어디에도 넣지 않는다
  const unpaid = sum((c) => c.status === "pending" || c.status === "reported");
  const paid = sum((c) => c.status === "confirmed");
  const waived = sum((c) => c.status === "waived");

  const statusOf = (c: BoardCharge) =>
    c.status === "waived"
      ? "waived"
      : c.status === "confirmed"
        ? "settled"
        : "unpaid";
  const shownMembers = [...byMember.entries()].filter(([, list]) =>
    filter === "all" ? true : list.some((c) => statusOf(c) === filter),
  );

  return (
    <div className="flex flex-col gap-3">
      {/* 요약 3카드 + 대사 버튼 */}
      <div className="grid gap-2.5 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">{t("crew.duesPaidLabel")}</p>
          <p className="tabular mt-1 text-xl font-extrabold">{won(paid)}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">{t("crew.duesUnpaidLabel")}</p>
          <p
            className={`tabular mt-1 text-xl font-extrabold ${unpaid > 0 ? "text-danger" : "text-success"}`}
          >
            {won(unpaid)}
          </p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">{t("crew.duesWaivedLabel")}</p>
          <p className="tabular mt-1 text-xl font-extrabold text-muted">
            {won(waived)}
          </p>
        </Card>
        <div className="flex flex-col justify-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              reconcile("generate_monthly_charges", t("crew.duesKindMonthly"))
            }
            disabled={busy != null || locked}
            className="rounded-lg border border-line-strong bg-control px-3 py-1.5 text-xs font-semibold hover:border-muted/60 disabled:opacity-50"
          >
            {busy === "generate_monthly_charges"
              ? "…"
              : t("crew.duesGenerate", { period: periodLabel })}
          </button>
          <button
            type="button"
            onClick={() =>
              reconcile("generate_session_charges", t("crew.duesKindSession"))
            }
            disabled={busy != null || locked}
            className="rounded-lg border border-line-strong bg-control px-3 py-1.5 text-xs font-semibold hover:border-muted/60 disabled:opacity-50"
          >
            {busy === "generate_session_charges"
              ? "…"
              : t("crew.duesGenerateSession", { period: periodLabel })}
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-danger">{err}</p>}
      {note && <p className="text-xs text-accent">{note}</p>}
      <p className="text-[11px] text-muted">{t("crew.duesGenHint")}</p>

      {/* 상태 칩 + 모두 펼치기 */}
      {charges.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "unpaid", "settled", "waived"] as const).map((k) => (
            <Chip
              key={k}
              active={filter === k}
              onClick={() => setFilter(k)}
              count={
                k === "all"
                  ? byMember.size
                  : [...byMember.values()].filter((l) =>
                      l.some((c) => statusOf(c) === k),
                    ).length
              }
            >
              {k === "all"
                ? t("crew.all")
                : k === "unpaid"
                  ? t("crew.duesFltUnpaid")
                  : k === "settled"
                    ? t("crew.duesSettled")
                    : t("crew.duesWaived")}
            </Chip>
          ))}
          {byMember.size > 1 && (
            <button
              type="button"
              onClick={() =>
                setOpen((p) =>
                  p.size === byMember.size ? new Set() : new Set(byMember.keys()),
                )
              }
              className="ml-auto text-xs text-accent hover:underline"
            >
              {open.size === byMember.size
                ? t("crew.duesCollapseAll")
                : t("crew.duesExpandAll")}
            </button>
          )}
        </div>
      )}

      {!charges.length ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-xs text-muted">{t("crew.duesNoCharges")}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {shownMembers.map(([uid, list]) => {
            const head = list[0];
            const memberUnpaid = list
              .filter((c) => c.status === "pending" || c.status === "reported")
              .reduce((a, c) => a + c.amount, 0);
            const memberTotal = list.reduce((a, c) => a + c.amount, 0);
            const allWaived = list.every((c) => c.status === "waived");
            return (
              <li
                key={uid}
                className="overflow-hidden rounded-2xl border border-line bg-card"
              >
                <button
                  type="button"
                  onClick={() => toggle(uid)}
                  aria-expanded={open.has(uid)}
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-card-hover"
                >
                  <Avatar name={head.display_name} size={36} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-bold">
                        {head.display_name}
                      </span>
                      {head.tier_name && (
                        <span
                          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${tierBadgeClass(head.tier_color)}`}
                        >
                          {head.tier_name}
                        </span>
                      )}
                    </span>
                    {head.email && (
                      <span className="truncate text-xs font-normal text-muted">
                        {head.email}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2.5">
                    <span className="tabular text-xs text-muted">
                      {t("crew.duesChargeCount", { n: list.length })} ·{" "}
                      {won(memberTotal)}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        memberUnpaid > 0
                          ? "bg-danger-bg text-danger"
                          : allWaived
                            ? "bg-line text-muted"
                            : "bg-success-bg text-success"
                      }`}
                    >
                      {memberUnpaid > 0
                        ? t("crew.duesOutstanding", { amount: won(memberUnpaid) })
                        : allWaived
                          ? t("crew.duesWaived")
                          : `✓ ${t("crew.duesSettled")}`}
                    </span>
                    <span aria-hidden className="text-xs text-muted">
                      {open.has(uid) ? "▾" : "▸"}
                    </span>
                  </span>
                </button>

                <ul
                  className="flex flex-col gap-1 border-t border-line bg-inset px-3 py-2.5"
                  hidden={!open.has(uid)}
                >
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
                      {c.status === "waived" && c.waive_reason && (
                        <span className="truncate text-[10px] text-muted">
                          {c.waive_reason}
                        </span>
                      )}
                      {c.status !== "confirmed" && (
                        <button
                          type="button"
                          onClick={() =>
                            c.status === "waived"
                              ? call(c.charge_id, "unwaive_dues_charge", {
                                  p_charge: c.charge_id,
                                })
                              : waive(c.charge_id)
                          }
                          disabled={busy != null || locked}
                          className={`${badge(
                            c.status === "waived"
                              ? "bg-track/15 text-track"
                              : "bg-background text-muted",
                          )} hover:brightness-125 disabled:opacity-50`}
                        >
                          {c.status === "waived"
                            ? t("crew.duesWaived")
                            : t("crew.duesWaive")}
                        </button>
                      )}
                      {c.status === "waived" ? null : c.status === "confirmed" ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(t("crew.duesUncheckConfirm"))) return;
                            call(c.charge_id, "unconfirm_dues_charge", {
                              p_charge: c.charge_id,
                            });
                          }}
                          disabled={busy != null || locked}
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
                          disabled={busy != null || locked}
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
