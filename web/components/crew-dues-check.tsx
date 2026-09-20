"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Avatar } from "@/components/ui/crew-ui";
import { Dialog } from "@/components/ui/dialog";
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
          <span className="font-mono text-sm font-bold text-gold">
            {won(outstanding)}
          </span>
        ) : (
          <span className={badge("bg-track/15 text-track")}>
            ✓ {t("crew.duesAllPaid")}
          </span>
        )}
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}

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
                <span className={badge("bg-accent/15 text-gold")}>
                  {t("crew.duesReported")}
                </span>
                <button
                  type="button"
                  onClick={() => report(c.charge_id, false)}
                  disabled={busy != null}
                  className="text-xs text-muted hover:text-danger disabled:opacity-50"
                >
                  {t("crew.duesCancelReport")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => report(c.charge_id, true)}
                disabled={busy != null}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground hover:brightness-95 disabled:opacity-40"
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


type MemberState = "unpaid" | "waived" | "settled";

/**
 * 회비 납부 보드 — 회계 탭의 운영진 전용 화면 (디자인 시안 §1).
 *
 * 청구를 회원별로 묶고 **미납 → 면제 → 완료** 순으로 세운다. 이 화면에 오는 이유가
 * "누가 아직 안 냈나"라서 미납이 위로 올라오고 미납 회원만 기본으로 펼쳐진다.
 * 완료 행은 눌러 접히는 압축 행이다.
 *
 * 청구 구성("월회비 + 모임 2회 + 면제 1건")을 이름 아래에 적어, 펼치지 않고도 그 달에
 * 무엇이 걸려 있는지 보이게 했다. 건별 액션(확인·면제·취소·해제)과 RPC 는 그대로다.
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
  /** 버튼이 어느 달을 대상으로 하는지 분명히 하기 위한 표시용 라벨 */
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
  /** 추가로 펼친 회원 */
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");
  /** 미납 요약을 누르면 뜨는 내역. 관리 탭의 "미납 회비" 타일과 같은 동작이지만
   *  이쪽은 **이 달** 청구만 본다 — 두 숫자가 다를 수 있어 모달에도 달을 적는다. */
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
      const tail = r.locked ? ` (${t("crew.duesGenLocked", { n: r.locked })})` : "";
      lines.push(`${kindLabel} — ${parts.length ? parts.join(" · ") : t("crew.duesGenNone")}${tail}`);
    }
    setBusy(null);
    setNote(`${periodLabel} · ${lines.join(" / ")}`);
    router.refresh();
  }

  // 회원별로 묶는다 — 보드는 이미 이름·종류 순으로 정렬돼 온다.
  const byMember = new Map<string, BoardCharge[]>();
  for (const c of charges) {
    const arr = byMember.get(c.user_id) ?? [];
    arr.push(c);
    byMember.set(c.user_id, arr);
  }

  const isOpen = (c: BoardCharge) => c.status === "pending" || c.status === "reported";
  const stateOf = (list: BoardCharge[]): MemberState =>
    list.some(isOpen) ? "unpaid" : list.every((c) => c.status === "waived") ? "waived" : "settled";
  const sum = (f: (c: BoardCharge) => boolean) =>
    charges.filter(f).reduce((a, c) => a + c.amount, 0);
  // 면제는 미납도 수입도 아니다 — 두 합계 어디에도 넣지 않는다
  const unpaid = sum(isOpen);
  const paid = sum((c) => c.status === "confirmed");
  const waived = sum((c) => c.status === "waived");
  // 인원수는 **회원 상태** 기준으로 센다 — 필터 칩과 같은 기준이어야 "완료 6" 을
  // 눌렀는데 5명만 나오는 일이 없다(미납 회원도 확정된 청구를 들고 있다).
  const stateCount = (st: MemberState) =>
    [...byMember.values()].filter((l) => stateOf(l) === st).length;
  // 납부율은 금액 기준, 면제 제외 — 면제까지 분모에 넣으면 아무도 100%가 되지 않는다
  const billable = paid + unpaid;
  const rate = billable > 0 ? (paid / billable) * 100 : 100;

  const ORDER: Record<MemberState, number> = { unpaid: 0, waived: 1, settled: 2 };

  const q = query.trim().toLowerCase();
  const members = [...byMember.entries()]
    .map(([uid, list]) => ({ uid, list, state: stateOf(list) }))
    .filter((m) => (filter === "all" ? true : m.state === filter))
    .filter((m) => !q || m.list[0].display_name.toLowerCase().includes(q))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  // 기본 펼침은 미납 회원. 닫은 쪽을 기억하므로 접었다 펴는 게 그대로 남는다.
  const expanded = (uid: string, state: MemberState) =>
    opened.has(uid) || (state === "unpaid" && !closed.has(uid));
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
  const allExpanded = members.every((m) => expanded(m.uid, m.state));

  /** 이 달 미납(확인 대기 포함) 청구를 회원별로 묶는다 */
  const unpaidByMember = [...byMember.entries()]
    .map(([uid, list]) => ({ uid, name: list[0].display_name, rows: list.filter(isOpen) }))
    .filter((m) => m.rows.length > 0);

  /** "월회비 + 모임 2회 + 면제 1건" — 펼치지 않고도 무엇이 걸려 있는지 보이게 */
  const breakdown = (list: BoardCharge[]) => {
    const parts: string[] = [];
    if (list.some((c) => c.kind === "monthly" && c.status !== "waived")) {
      parts.push(t("crew.duesKindMonthly"));
    }
    const sessions = list.filter((c) => c.kind === "session" && c.status !== "waived").length;
    if (sessions) parts.push(t("crew.duesBreakdownSessions", { n: sessions }));
    const custom = list.filter((c) => c.kind === "custom" && c.status !== "waived").length;
    if (custom) parts.push(t("crew.duesBreakdownCustom", { n: custom }));
    const exempt = list.filter((c) => c.status === "waived").length;
    if (exempt) parts.push(t("crew.duesBreakdownExempt", { n: exempt }));
    return parts.join(" + ");
  };
  const shortDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(locale, { month: "numeric", day: "numeric" })
      : null;

  const CARD = "overflow-hidden rounded-[14px] border border-line bg-card";
  const cols =
    "grid grid-cols-[32px_minmax(0,1fr)_auto_20px] items-center gap-2.5 sm:grid-cols-[32px_minmax(0,1fr)_120px_110px_28px] sm:gap-3";
  const seg = (k: typeof filter, label: string, n: number) => (
    <button
      key={k}
      type="button"
      aria-pressed={filter === k}
      onClick={() => setFilter(k)}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors ${
        filter === k ? "bg-accent text-accent-foreground" : "text-foreground-2 hover:text-foreground"
      }`}
    >
      {label}
      <span className={`text-[11px] ${filter === k ? "text-gold-line" : "text-muted-3"}`}>{n}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <Dialog
        open={unpaidOpen}
        onClose={() => setUnpaidOpen(false)}
        label={t("crew.unpaidTitle")}
        closeLabel={t("common.close")}
        variant="center"
        panelClassName="max-w-lg rounded-2xl border border-line bg-card text-foreground"
      >
        <div className="px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold">{t("crew.unpaidTitle")}</h3>
            <span className="tabular text-sm font-bold text-danger">{won(unpaid)}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {t("crew.unpaidMonthHint", { period: periodLabel })}
          </p>

          <ul className="mt-3 flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
            {unpaidByMember.map((m) => (
              <li key={m.uid} className="rounded-xl bg-inset px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{m.name}</span>
                  <span className="tabular shrink-0 text-xs text-gold">
                    {won(m.rows.reduce((a, c) => a + c.amount, 0))}
                  </span>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {m.rows.map((c) => (
                    <li key={c.charge_id} className="flex items-baseline gap-2 text-xs text-muted">
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.status === "reported" && (
                        <span className="shrink-0 text-gold">{t("crew.duesReported")}</span>
                      )}
                      <span className="tabular shrink-0">{won(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3">
            {/* 확정·면제 버튼은 아래 목록에 있다 — 거기로 데려다준다 */}
            <button
              type="button"
              onClick={() => {
                setFilter("unpaid");
                setUnpaidOpen(false);
              }}
              className="text-xs text-gold hover:underline"
            >
              {t("crew.unpaidFilterHere")}
            </button>
            <button
              type="button"
              onClick={() => setUnpaidOpen(false)}
              className="rounded-lg bg-control px-4 py-1.5 text-xs font-semibold"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </Dialog>

      {/* ── §1-a 요약 ── */}
      <div className={`${CARD} flex flex-col`}>
        <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-[18px] py-3.5">
            <p className="text-xs text-muted">{t("crew.duesPaidLabel")}</p>
            <p className="tabular mt-1 text-[22px] font-extrabold leading-tight">{won(paid)}</p>
            <p className="mt-0.5 text-xs text-muted-3">{t("crew.memberN", { n: stateCount("settled") })}</p>
          </div>
          {/* 미납은 눌러서 내역을 본다 — 관리 탭의 미납 타일과 같은 동작 */}
          {unpaid > 0 ? (
            <button
              type="button"
              onClick={() => setUnpaidOpen(true)}
              className="px-[18px] py-3.5 text-left hover:bg-card-hover"
            >
              <p className="text-xs text-muted">{t("crew.duesUnpaidLabel")}</p>
              <p className="tabular mt-1 text-[22px] font-extrabold leading-tight text-danger">
                {won(unpaid)}
              </p>
              <p className="mt-0.5 text-xs text-gold">
                {t("crew.memberN", { n: stateCount("unpaid") })} · {t("crew.unpaidOpen")}
              </p>
            </button>
          ) : (
            <div className="px-[18px] py-3.5">
              <p className="text-xs text-muted">{t("crew.duesUnpaidLabel")}</p>
              <p className="tabular mt-1 text-[22px] font-extrabold leading-tight text-success">
                {won(0)}
              </p>
              <p className="mt-0.5 text-xs text-muted-3">{t("crew.duesAllPaid")}</p>
            </div>
          )}
          <div className="px-[18px] py-3.5">
            <p className="text-xs text-muted">{t("crew.duesWaivedLabel")}</p>
            <p className="tabular mt-1 text-[22px] font-extrabold leading-tight text-muted">
              {won(waived)}
            </p>
            <p className="mt-0.5 text-xs text-muted-3">{t("crew.memberN", { n: stateCount("waived") })}</p>
          </div>
        </div>
        {/* 납부율 — 금액 기준, 면제 제외 */}
        <div className="flex flex-col gap-1.5 border-t border-line px-[18px] py-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>{t("crew.duesRateNote")}</span>
            <strong className="tabular text-sm font-extrabold text-foreground">
              {rate.toFixed(1)}%
            </strong>
          </div>
          <span className="flex h-2 overflow-hidden rounded-full bg-line-soft">
            <span className="h-full bg-accent" style={{ width: `${rate}%` }} />
            <span className="h-full flex-1 bg-danger" />
          </span>
        </div>
      </div>

      {err && (
        <p role="alert" className="text-xs text-danger">
          {err}
        </p>
      )}
      {note && <p className="text-xs text-gold">{note}</p>}

      {/* ── §1-b 목록 ── */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-[18px] py-3.5">
          <div className="flex flex-wrap gap-1 rounded-full border border-line-mid bg-page p-[3px]">
            {seg("all", t("crew.filterAll"), byMember.size)}
            {seg("unpaid", t("crew.duesFltUnpaid"), stateCount("unpaid"))}
            {seg("settled", t("crew.duesSettled"), stateCount("settled"))}
            {seg("waived", t("crew.duesWaived"), stateCount("waived"))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              size={1}
              placeholder={t("crew.memberSearch")}
              className="h-8 w-[150px] max-w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-[13px] outline-none focus:border-accent-line"
            />
            <button
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
              className="h-8 shrink-0 rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold hover:border-line-strong disabled:opacity-50"
            >
              {busy === "recalc" ? "…" : `↻ ${t("crew.duesRecalc")}`}
            </button>
          </div>
        </div>

        {!charges.length ? (
          <div className="flex flex-col items-center gap-3 px-[18px] py-10 text-center">
            <p className="text-[13px] text-muted">{t("crew.duesNoCharges")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                disabled={busy != null || locked}
                onClick={() =>
                  reconcile(
                    [["generate_monthly_charges", t("crew.duesKindMonthly")]],
                    "generate_monthly_charges",
                  )
                }
                className="h-9 rounded-lg bg-accent px-4 text-[13px] font-extrabold text-accent-foreground disabled:opacity-40"
              >
                {busy === "generate_monthly_charges"
                  ? "…"
                  : t("crew.duesGenerate", { period: periodLabel })}
              </button>
              <button
                type="button"
                disabled={busy != null || locked}
                onClick={() =>
                  reconcile(
                    [["generate_session_charges", t("crew.duesKindSession")]],
                    "generate_session_charges",
                  )
                }
                className="h-9 rounded-lg border border-line-strong bg-control px-4 text-[13px] font-semibold hover:border-line-strong disabled:opacity-50"
              >
                {busy === "generate_session_charges"
                  ? "…"
                  : t("crew.duesGenerateSession", { period: periodLabel })}
              </button>
            </div>
            <p className="max-w-md text-xs text-muted-3">{t("crew.duesGenHint")}</p>
          </div>
        ) : (
          <>
            <div
              className={`hidden ${cols} border-b border-line-soft px-[18px] py-2 text-[11px] font-bold tracking-[0.06em] text-muted-3 sm:grid`}
            >
              <span />
              <span>{t("crew.duesColMember")}</span>
              <span className="text-right">{t("crew.duesColDue")}</span>
              <span className="text-right">{t("crew.duesColStatus")}</span>
              <span />
            </div>

            {members.map(({ uid, list, state }) => {
              const head = list[0];
              const open = expanded(uid, state);
              const memberUnpaid = list.filter(isOpen).reduce((a, c) => a + c.amount, 0);
              // 청구 합계에서 면제는 뺀다 — 낼 돈이 아니다
              const memberTotal = list
                .filter((c) => c.status !== "waived")
                .reduce((a, c) => a + c.amount, 0);
              return (
                <div
                  key={uid}
                  className={`border-b border-line-soft ${
                    state === "unpaid" ? "bg-danger-card" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(uid, state)}
                    aria-expanded={open}
                    className={`${cols} w-full px-[18px] text-left hover:bg-card-hover ${
                      state === "settled" ? "py-2" : "py-3"
                    }`}
                  >
                    <Avatar name={head.display_name} size={32} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold">{head.display_name}</span>
                        {head.tier_name && (
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${tierBadgeClass(head.tier_color)}`}
                          >
                            {head.tier_name}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-normal text-muted-3">
                        {breakdown(list)}
                      </span>
                    </span>
                    <span className="tabular hidden text-right text-sm font-bold sm:block">
                      {won(memberTotal)}
                    </span>
                    <span className="flex flex-col items-end gap-0.5 sm:block sm:text-right">
                      <span className="tabular text-xs font-bold sm:hidden">
                        {won(memberTotal)}
                      </span>
                      <span
                        className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                          state === "unpaid"
                            ? "bg-danger-bg text-danger"
                            : state === "waived"
                              ? "bg-line text-muted"
                              : "text-success"
                        }`}
                      >
                        {state === "unpaid"
                          ? t("crew.duesOutstanding", { amount: won(memberUnpaid) })
                          : state === "waived"
                            ? t("crew.duesStatusExemptAll")
                            : `✓ ${t("crew.duesStatusDone")}`}
                      </span>
                    </span>
                    <span aria-hidden className="text-right text-[11px] text-muted-3">
                      {open ? "▲" : "▼"}
                    </span>
                  </button>

                  {/* 펼침 — 건별 카드 */}
                  <ul className="flex flex-col gap-1.5 px-[18px] pb-3.5 sm:pl-16" hidden={!open}>
                    {list.map((c) => {
                      const exempt = c.status === "waived";
                      const done = c.status === "confirmed";
                      return (
                        <li
                          key={c.charge_id}
                          className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_90px_auto] ${
                            !exempt && !done
                              ? "border-danger-line bg-danger-card"
                              : "border-line-soft bg-page"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold">
                              {c.label}
                            </span>
                            <span className="block text-[11px] text-muted-3">
                              {c.kind === "monthly"
                                ? t("crew.duesKindMonthly")
                                : c.kind === "session"
                                  ? t("crew.duesKindSession")
                                  : t("crew.duesKindCustom")}
                              {shortDate(c.event_at) ? ` · ${shortDate(c.event_at)}` : ""}
                              {exempt && c.waive_reason ? ` · ${c.waive_reason}` : ""}
                            </span>
                          </span>
                          <span
                            className={`tabular text-right text-[13px] font-bold ${exempt ? "text-muted-3 line-through" : ""}`}
                          >
                            {won(c.amount)}
                          </span>
                          <span className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1">
                            {c.status === "reported" && (
                              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-gold">
                                {t("crew.duesReported")}
                              </span>
                            )}
                            {exempt ? (
                              <>
                                <span className="text-[11px] text-muted">
                                  {t("crew.duesWaived")}
                                </span>
                                <button
                                  type="button"
                                  disabled={busy != null || locked}
                                  onClick={() =>
                                    call(c.charge_id, "unwaive_dues_charge", {
                                      p_charge: c.charge_id,
                                    })
                                  }
                                  className="text-[11px] text-muted-3 hover:text-foreground disabled:opacity-50"
                                >
                                  {t("crew.duesRelease")}
                                </button>
                              </>
                            ) : done ? (
                              <>
                                <span className="text-xs font-bold text-success">
                                  ✓ {t("crew.duesConfirmed")}
                                </span>
                                <button
                                  type="button"
                                  disabled={busy != null || locked}
                                  onClick={() => {
                                    if (!window.confirm(t("crew.duesUncheckConfirm"))) return;
                                    call(c.charge_id, "unconfirm_dues_charge", {
                                      p_charge: c.charge_id,
                                    });
                                  }}
                                  className="text-[11px] text-muted-3 hover:text-danger disabled:opacity-50"
                                >
                                  {t("crew.duesUndo")}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={busy != null || locked}
                                  onClick={() => waive(c.charge_id)}
                                  className="h-7 shrink-0 rounded-md border border-line-strong px-2.5 text-[11px] font-semibold text-muted hover:border-line-strong hover:text-foreground disabled:opacity-50"
                                >
                                  {t("crew.duesWaive")}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy != null || locked}
                                  onClick={() =>
                                    call(c.charge_id, "confirm_dues_charge", {
                                      p_charge: c.charge_id,
                                    })
                                  }
                                  className="h-7 shrink-0 rounded-md bg-accent px-2.5 text-[11px] font-extrabold text-accent-foreground hover:brightness-95 disabled:opacity-40"
                                >
                                  ✓ {t("crew.duesConfirm")}
                                </button>
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            {members.length === 0 && (
              <p className="px-[18px] py-8 text-center text-[13px] text-muted-3">
                {t("crew.filterEmpty")}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 px-[18px] py-3 text-xs text-muted-3">
              <span>
                {t("crew.duesShownN", { n: members.length, m: byMember.size })}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (allExpanded) {
                    setOpened(new Set());
                    setClosed(new Set(byMember.keys()));
                  } else {
                    setClosed(new Set());
                    setOpened(new Set(byMember.keys()));
                  }
                }}
                className="font-bold text-gold hover:underline"
              >
                {allExpanded ? t("crew.duesCollapseAll") : t("crew.duesExpandAll")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
