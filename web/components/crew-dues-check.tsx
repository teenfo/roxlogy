"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { tierChipTone } from "@/lib/crew-role";
import { duesErrText } from "@/lib/dues-error";
import { won } from "@/lib/won";
import { Button } from "@/components/ui/button";
import { RoxDialog } from "@/components/rox/dialog";
import { Chip, DataTable, Empty, Find, Hint, Panel, ProgressBar, Segments } from "@/components/rox/ui";

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

/** 내 회비 — 소개 탭 "나의 회비" Panel 안. 미납 청구를 건별로 보여주고 납부 신고를 받는다.
 *  월회비와 회차비가 섞이므로 합계는 Panel 이 먼저 보여준다(페이지). */
export function CrewDuesSelfReport({ charges }: { charges: MyCharge[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function report(id: string, on: boolean) {
    setBusy(id);
    setErr(null);
    const { error } = await createClient().rpc("report_dues_charge", { p_charge: id, p_on: on });
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  if (!charges.length) return null;

  return (
    <>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      <DataTable
        headers={[t("crew.finColDesc"), t("crew.finAmount"), t("crew.duesColStatus")]}
        rows={charges.slice(0, 12).map((c) => [
          <span key="l">
            {c.label}
            {c.kind === "session" && <small className="rx-block rx-muted">{t("crew.duesKindSession")}</small>}
          </span>,
          <strong key="a" className="rx-number" style={c.status === "waived" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
            {won(c.amount)}
          </strong>,
          <span key="s" className="rx-actions" style={{ flexWrap: "nowrap" }}>
            {c.status === "waived" ? (
              <Chip tone="blue">
                {t("crew.duesWaived")}
                {c.waive_reason ? ` · ${c.waive_reason}` : ""}
              </Chip>
            ) : c.status === "confirmed" ? (
              <Chip tone="green">✓ {t("crew.duesConfirmed")}</Chip>
            ) : c.status === "reported" ? (
              <>
                <Chip tone="yellow">{t("crew.duesReported")}</Chip>
                <Button variant="ghost" size="sm" type="button" onClick={() => report(c.charge_id, false)} disabled={busy != null}>
                  {t("crew.duesCancelReport")}
                </Button>
              </>
            ) : (
              <Button className="rx-primary" size="sm" type="button" onClick={() => report(c.charge_id, true)} disabled={busy != null}>
                {t("crew.duesReport")}
              </Button>
            )}
          </span>,
        ])}
      />
    </>
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

type MemberState = "unpaid" | "waived" | "settled";

/**
 * 회비 납부 보드 — 시안 finance.tsx 의 "회비 관리" 탭 그대로 (PORT_PLAN §3-e):
 * Panel "이번 달 회비 현황"(.rx-finance-dues-kpis 3칸 · .rx-finance-progress-label · ProgressBar) ·
 * Panel "회비 대상자"(.rx-toolbar Segments+Find · DataTable[회원·구분·금액·상태] · Empty · Hint).
 * 청구 건별 확정·면제·대사 버튼과 펼침은 우리 기능이라 같은 표의 하위 행으로 얹는다(§4).
 */
export function CrewDuesMatrix({
  crewId,
  period,
  periodLabel,
  charges,
  locked = false,
  initialFilter = "all",
}: {
  crewId: string;
  period: string;
  periodLabel: string;
  charges: BoardCharge[];
  /** 마감된 달 — 확정·면제·대사를 막는다 (DB 트리거도 같이 막는다) */
  locked?: boolean;
  /** 사이드 "확인할 일" 카드에서 ?f=unpaid 로 들어온 경우 미납만 펴고 시작한다 */
  initialFilter?: "all" | "unpaid" | "settled" | "waived";
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** 접은 회원. 기본은 미납만 펼침이라, 펼친 쪽이 아니라 **닫은 쪽**을 들고 있는다 */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");
  const [unpaidOpen, setUnpaidOpen] = useState(false);

  async function call(key: string, fn: string, args: Record<string, unknown>) {
    setBusy(key);
    setErr(null);
    setNote(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  /** 면제 — 사유를 남긴다(취소하면 아무 일도 안 함). 면제는 미납도 수입도 아니다. */
  function waive(id: string) {
    const reason = window.prompt(t("crew.duesWaivePrompt"), "");
    if (reason === null) return;
    call(id, "waive_dues_charge", { p_charge: id, p_reason: reason });
  }

  /** 대사(reconcile)는 그 달을 현재 등급·요금·출석에 맞추는 동작이라 결과를 반드시 알린다. */
  async function reconcile(rpcs: [string, string][], key: string) {
    setBusy(key);
    setErr(null);
    setNote(null);
    const client = createClient();
    const lines: string[] = [];
    for (const [rpc, kindLabel] of rpcs) {
      const { data, error } = await client.rpc(rpc, { p_crew: crewId, p_period: period });
      if (error) {
        setBusy(null);
        return setErr(duesErrText(t, error.message));
      }
      const r = (data ?? {}) as { created?: number; updated?: number; removed?: number; locked?: number };
      const parts: string[] = [];
      if (r.created) parts.push(t("crew.duesGenCreated", { n: r.created }));
      if (r.updated) parts.push(t("crew.duesGenUpdated", { n: r.updated }));
      if (r.removed) parts.push(t("crew.duesGenRemoved", { n: r.removed }));
      const tail = r.locked ? ` (${t("crew.duesGenLocked", { n: r.locked })})` : "";
      lines.push(`${kindLabel} — ${parts.length ? parts.join(" · ") : t("crew.duesGenNone")}${tail}`);
    }
    setBusy(null);
    setNote(`${periodLabel} · ${lines.join(" / ")}`);
    router.refresh();
  }

  const byMember = new Map<string, BoardCharge[]>();
  for (const c of charges) {
    const arr = byMember.get(c.user_id) ?? [];
    arr.push(c);
    byMember.set(c.user_id, arr);
  }

  const isOpen = (c: BoardCharge) => c.status === "pending" || c.status === "reported";
  const stateOf = (list: BoardCharge[]): MemberState =>
    list.some(isOpen) ? "unpaid" : list.every((c) => c.status === "waived") ? "waived" : "settled";
  const sum = (f: (c: BoardCharge) => boolean) => charges.filter(f).reduce((a, c) => a + c.amount, 0);
  const unpaid = sum(isOpen);
  const paid = sum((c) => c.status === "confirmed");
  const waived = sum((c) => c.status === "waived");
  const stateCount = (st: MemberState) => [...byMember.values()].filter((l) => stateOf(l) === st).length;
  // 납부율은 금액 기준, 면제 제외
  const billable = paid + unpaid;
  const rate = billable > 0 ? (paid / billable) * 100 : 100;

  const ORDER: Record<MemberState, number> = { unpaid: 0, waived: 1, settled: 2 };
  const q = query.trim().toLowerCase();
  const members = [...byMember.entries()]
    .map(([uid, list]) => ({ uid, list, state: stateOf(list) }))
    .filter((m) => (filter === "all" ? true : m.state === filter))
    .filter((m) => !q || m.list[0].display_name.toLowerCase().includes(q))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  const expanded = (uid: string, state: MemberState) => opened.has(uid) || (state === "unpaid" && !closed.has(uid));
  const toggle = (uid: string, state: MemberState) => {
    if (expanded(uid, state)) {
      setOpened((p) => {
        const n = new Set(p);
        n.delete(uid);
        return n;
      });
      setClosed((p) => new Set(p).add(uid));
    } else {
      setClosed((p) => {
        const n = new Set(p);
        n.delete(uid);
        return n;
      });
      setOpened((p) => new Set(p).add(uid));
    }
  };

  const unpaidByMember = [...byMember.entries()]
    .map(([uid, list]) => ({ uid, name: list[0].display_name, rows: list.filter(isOpen) }))
    .filter((m) => m.rows.length > 0);

  /** "월회비 + 모임 2회 + 면제 1건" — 펼치지 않고도 무엇이 걸려 있는지 보이게 */
  const breakdown = (list: BoardCharge[]) => {
    const parts: string[] = [];
    if (list.some((c) => c.kind === "monthly" && c.status !== "waived")) parts.push(t("crew.duesKindMonthly"));
    const sessions = list.filter((c) => c.kind === "session" && c.status !== "waived").length;
    if (sessions) parts.push(t("crew.duesBreakdownSessions", { n: sessions }));
    const custom = list.filter((c) => c.kind === "custom" && c.status !== "waived").length;
    if (custom) parts.push(t("crew.duesBreakdownCustom", { n: custom }));
    const exempt = list.filter((c) => c.status === "waived").length;
    if (exempt) parts.push(t("crew.duesBreakdownExempt", { n: exempt }));
    return parts.join(" + ");
  };
  const shortDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { month: "numeric", day: "numeric" }) : null;

  const stateChip = (state: MemberState, memberUnpaid: number) =>
    state === "unpaid" ? (
      <Chip tone="red">{t("crew.duesOutstanding", { amount: won(memberUnpaid) })}</Chip>
    ) : state === "waived" ? (
      <Chip>{t("crew.duesStatusExemptAll")}</Chip>
    ) : (
      <Chip tone="green">✓ {t("crew.duesStatusDone")}</Chip>
    );

  /** 회원 행 + (펼쳤으면) 청구 행들 */
  const tableRows = members.flatMap(({ uid, list, state }) => {
    const head = list[0];
    const open = expanded(uid, state);
    const memberUnpaid = list.filter(isOpen).reduce((a, c) => a + c.amount, 0);
    const memberTotal = list.filter((c) => c.status !== "waived").reduce((a, c) => a + c.amount, 0);
    const memberRow = [
      <button key="m" type="button" className="rx-person" onClick={() => toggle(uid, state)} aria-expanded={open} style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}>
        <span className="rx-avatar">{head.display_name.slice(0, 1)}</span>
        <span>
          <b>{head.display_name}</b>
          <small>
            {breakdown(list)} {open ? "▲" : "▼"}
          </small>
        </span>
      </button>,
      <span key="t">{head.tier_name ? <Chip tone={tierChipTone(head.tier_color)}>{head.tier_name}</Chip> : "—"}</span>,
      <strong key="a" className="rx-number">
        {won(memberTotal)}
      </strong>,
      <span key="s">{stateChip(state, memberUnpaid)}</span>,
    ];
    if (!open) return [memberRow];
    const chargeRows = list.map((c) => {
      const exempt = c.status === "waived";
      const done = c.status === "confirmed";
      return [
        <span key="l" style={{ paddingLeft: 24 }} className="rx-muted">
          {c.label}
          <small className="rx-block">
            {c.kind === "monthly" ? t("crew.duesKindMonthly") : c.kind === "session" ? t("crew.duesKindSession") : t("crew.duesKindCustom")}
            {shortDate(c.event_at) ? ` · ${shortDate(c.event_at)}` : ""}
            {exempt && c.waive_reason ? ` · ${c.waive_reason}` : ""}
          </small>
        </span>,
        <span key="k" className="rx-muted">
          {c.status === "reported" ? <Chip tone="yellow">{t("crew.duesReported")}</Chip> : ""}
        </span>,
        <span key="a" className="rx-number rx-muted" style={exempt ? { textDecoration: "line-through" } : undefined}>
          {won(c.amount)}
        </span>,
        <span key="x" className="rx-actions" style={{ flexWrap: "nowrap" }}>
          {exempt ? (
            <>
              <Chip>{t("crew.duesWaived")}</Chip>
              <Button variant="ghost" size="sm" type="button" disabled={busy != null || locked} onClick={() => call(c.charge_id, "unwaive_dues_charge", { p_charge: c.charge_id })}>
                {t("crew.duesRelease")}
              </Button>
            </>
          ) : done ? (
            <>
              <Chip tone="green">✓ {t("crew.duesConfirmed")}</Chip>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={busy != null || locked}
                onClick={() => {
                  if (!window.confirm(t("crew.duesUncheckConfirm"))) return;
                  call(c.charge_id, "unconfirm_dues_charge", { p_charge: c.charge_id });
                }}
              >
                {t("crew.duesUndo")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" type="button" disabled={busy != null || locked} onClick={() => waive(c.charge_id)}>
                {t("crew.duesWaive")}
              </Button>
              <Button className="rx-primary" size="sm" type="button" disabled={busy != null || locked} onClick={() => call(c.charge_id, "confirm_dues_charge", { p_charge: c.charge_id })}>
                ✓ {t("crew.duesConfirm")}
              </Button>
            </>
          )}
        </span>,
      ];
    });
    return [memberRow, ...chargeRows];
  });

  return (
    <>
      <RoxDialog
        open={unpaidOpen}
        onOpenChange={setUnpaidOpen}
        title={t("crew.unpaidTitle")}
        description={t("crew.unpaidMonthHint", { period: periodLabel })}
      >
        <div className="rx-actions">
          <Chip tone="red">{won(unpaid)}</Chip>
        </div>
        <DataTable
          headers={[t("crew.colMember"), t("crew.finColDesc"), t("crew.finAmount")]}
          rows={unpaidByMember.flatMap((m) =>
            m.rows.map((c, i) => [
              <span key="n">{i === 0 ? <b>{m.name}</b> : ""}</span>,
              <span key="l">
                {c.label}
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
          )}
        />
        <div className="rx-actions" style={{ marginTop: 16 }}>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              setFilter("unpaid");
              setUnpaidOpen(false);
            }}
          >
            {t("crew.unpaidFilterHere")}
          </Button>
          <Button variant="ghost" type="button" onClick={() => setUnpaidOpen(false)}>
            {t("common.close")}
          </Button>
        </div>
      </RoxDialog>

      <Panel title={t("crew.finDuesStatus")}>
        <div className="rx-finance-dues-kpis">
          <div>
            <span>{t("crew.duesPaidLabel")}</span>
            <strong>{won(paid)}</strong>
            <small>{t("crew.memberN", { n: stateCount("settled") })}</small>
          </div>
          <div
            role={unpaid > 0 ? "button" : undefined}
            tabIndex={unpaid > 0 ? 0 : undefined}
            onClick={() => unpaid > 0 && setUnpaidOpen(true)}
            onKeyDown={(e) => unpaid > 0 && (e.key === "Enter" || e.key === " ") && setUnpaidOpen(true)}
            style={unpaid > 0 ? { cursor: "pointer" } : undefined}
          >
            <span>{t("crew.duesUnpaidLabel")}</span>
            <strong className={unpaid > 0 ? "rx-expense" : "rx-income"}>{won(unpaid)}</strong>
            <small>
              {unpaid > 0 ? `${t("crew.memberN", { n: stateCount("unpaid") })} · ${t("crew.unpaidOpen")}` : t("crew.duesAllPaid")}
            </small>
          </div>
          <div>
            <span>{t("crew.duesWaivedLabel")}</span>
            <strong>{won(waived)}</strong>
            <small>{t("crew.memberN", { n: stateCount("waived") })}</small>
          </div>
        </div>
        <div className="rx-finance-progress-label">
          <span>{t("crew.finRateLabel")}</span>
          <b>{rate.toFixed(0)}%</b>
        </div>
        <ProgressBar value={rate} label={t("crew.duesRateNote")} />
      </Panel>

      <Panel
        title={t("crew.finDuesMembers")}
        action={
          <Button
            variant="outline"
            size="sm"
            type="button"
            title={t("crew.duesRecalcTip")}
            disabled={busy != null || locked}
            onClick={() =>
              reconcile(
                [
                  ["generate_monthly_charges", t("crew.duesKindMonthly")],
                  ["generate_session_charges", t("crew.duesKindSession")],
                ],
                "recalc",
              )
            }
          >
            <RefreshCw size={14} />
            {busy === "recalc" ? "…" : t("crew.duesRecalc")}
          </Button>
        }
      >
        {err && (
          <p role="alert" className="rx-error">
            {err}
          </p>
        )}
        {note && <Hint>{note}</Hint>}
        <div className="rx-toolbar">
          <Segments
            label={t("crew.duesColStatus")}
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            options={[
              ["all", `${t("crew.filterAll")} ${byMember.size}`],
              ["unpaid", `${t("crew.duesFltUnpaid")} ${stateCount("unpaid")}`],
              ["settled", `${t("crew.duesSettled")} ${stateCount("settled")}`],
              ["waived", `${t("crew.duesWaived")} ${stateCount("waived")}`],
            ]}
          />
          <Find value={query} onChange={setQuery} placeholder={t("crew.memberSearch")} />
        </div>
        {!charges.length ? (
          <Empty
            title={t("crew.duesNoCharges")}
            description={t("crew.duesGenHint")}
            action={
              <div className="rx-actions">
                <Button
                  className="rx-primary"
                  type="button"
                  disabled={busy != null || locked}
                  onClick={() => reconcile([["generate_monthly_charges", t("crew.duesKindMonthly")]], "generate_monthly_charges")}
                >
                  {busy === "generate_monthly_charges" ? "…" : t("crew.duesGenerate", { period: periodLabel })}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy != null || locked}
                  onClick={() => reconcile([["generate_session_charges", t("crew.duesKindSession")]], "generate_session_charges")}
                >
                  {busy === "generate_session_charges" ? "…" : t("crew.duesGenerateSession", { period: periodLabel })}
                </Button>
              </div>
            }
          />
        ) : tableRows.length ? (
          <DataTable
            headers={[t("crew.duesColMember"), t("crew.colTier"), t("crew.duesColDue"), t("crew.duesColStatus")]}
            rows={tableRows}
          />
        ) : (
          <Empty title={t("crew.filterEmpty")} description={t("crew.memberSearch")} />
        )}
        <Hint>{t("crew.duesShownN", { n: members.length, m: byMember.size })}</Hint>
      </Panel>
    </>
  );
}
