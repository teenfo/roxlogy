import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Landmark, Lock } from "lucide-react";
import { getCrew } from "@/lib/crew";
import { isFullMember } from "@/lib/crew-types";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { todayISOIn } from "@/lib/format";
import { categoryDictKey } from "@/lib/ledger-category";
import { won } from "@/lib/won";
import { CrewLedgerForm } from "@/components/crew-ledger-form";
import { CrewDuesMatrix, type BoardCharge } from "@/components/crew-dues-check";
import { CrewLedgerTable, type LedgerTableRow } from "@/components/crew-ledger-table";
import { CrewFinanceExport } from "@/components/crew-finance-export";
import { CrewExpenseMix } from "@/components/crew-expense-mix";
import { CrewDuesNotify } from "@/components/crew-dues-notify";
import { AccessGate } from "@/components/ui/access-gate";
import { CrewBankOpening } from "@/components/crew-bank-opening";
import { CrewMonthClose } from "@/components/crew-month-close";
import { CrewLedgerSettleMonth } from "@/components/crew-ledger-settle";
import { QuerySegments } from "@/components/rox/query-filters";
import { Button } from "@/components/ui/button";
import { Chip, Go, Hint, Panel, Stats } from "@/components/rox/ui";

type LedgerRow = {
  id: string;
  entry_date: string;
  kind: "income" | "expense";
  amount: number;
  title: string;
  source: string | null;
  memo: string | null;
  /** 현금·카드·이체·기타. 예전 기록은 비어 있다 */
  method: string | null;
  /** 통장에 찍힌 날. 비어 있으면 아직 통장 미반영 */
  settled_on: string | null;
  /** 거래 분류(영어 키) — 옛 행은 null */
  category: string | null;
  /** 회비 확정으로 생긴 행의 회차 키 (마이그레이션 108) */
  dues_group: string | null;
};

/** YYYY-MM → [1일, 말일] */
function monthRange(m: string): [string, string] {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, "0")}`];
}

function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 크루 회계 — 시안 finance.tsx Finance() 그대로 (PORT_PLAN §3-e):
 * .rx-finance[ .rx-subhead(제목·월 + 내보내기) · Stats 4 · .rx-finance-tabs(Segments + 잠금 안내) ·
 * .rx-finance-layout[ .rx-finance-content(거래 장부 | 회비 관리) | aside.rx-finance-aside(거래 추가 · 지출 구성 · 크루 계좌 · 회비 기준) ] ].
 * 월 이동·마감·확인할 일(rx-notice)은 우리 것(§4). 정회원 전용 — 일반회원·비멤버는 AccessGate.
 */
export default async function CrewFinancePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ m?: string; tab?: string; f?: string }> }) {
  const { slug } = await params;
  const { m, tab, f } = await searchParams;

  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  // 기본 월은 사용자 시간대 기준. 서버의 new Date() 는 UTC 라 매월 1일 아침
  // (KST)에 지난달이 열리고, 그 상태로 "월회비 청구 생성"을 누르면 엉뚱한
  // 달에 청구가 생긴다.
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : todayISOIn(tz).slice(0, 7);
  const [from, to] = monthRange(month);

  // 회계는 정회원(리더·부리더·정회원)에게만 공개 — 일반회원(associate)·비멤버 제외
  const isFull = crew.my_status === "active" && crew.my_role != null && isFullMember(crew.my_role);
  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";
  // 회비 보드는 운영진 전용 — 일반 정회원에게는 탭이 장부 하나뿐이다
  const view: "ledger" | "dues" = isStaff && tab === "dues" ? "dues" : "ledger";

  if (!isFull) {
    return <AccessGate title={t("crew.financeTab")} reason={t("crew.finFullOnly")} action={{ href: `/crews/${slug}`, label: t("crew.about") }} />;
  }

  const supabase = await createClient();
  const [{ data: rows }, { data: allRows }, { data: chargeRows }, { data: bankRow }, { data: closeRow }, { data: tierRows }, { count: unpaidCount }] = await Promise.all([
    supabase
      .from("crew_ledger")
      .select("id, entry_date, kind, amount, title, memo, source, method, settled_on, category, dues_group")
      .eq("crew_id", crew.id)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
    // 누적 잔액용 전체 거래 — 합계뿐 아니라 행별 러닝 잔액도 여기서 만든다
    supabase.from("crew_ledger").select("id, entry_date, created_at, kind, amount, settled_on").eq("crew_id", crew.id).order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    // 회비 청구 보드 (운영진만 — RPC 가 스태프를 검증)
    isStaff && view === "dues" ? supabase.rpc("crew_dues_board", { p_slug: slug, p_period: month }) : Promise.resolve({ data: null }),
    // 통장 기초 잔액 — 정회원만 조회된다(crew_bank RLS)
    supabase.from("crew_bank").select("opening_balance, opening_on").eq("crew_id", crew.id).maybeSingle(),
    // 이 달 마감 여부
    supabase.from("crew_month_close").select("closed_at").eq("crew_id", crew.id).eq("period", month).maybeSingle(),
    // 이 달 청구 기준 카드 — 등급이 곧 요금표다 (회비 탭에서만)
    isStaff && view === "dues"
      ? supabase.from("crew_member_tiers").select("id, name, color, monthly_fee, session_fee").eq("crew_id", crew.id).is("archived_at", null).order("sort_order")
      : Promise.resolve({ data: null }),
    // 마감 전 경고용 미수 건수 — 운영진만 (crew_dues_charges RLS)
    isStaff ? supabase.from("crew_dues_charges").select("id", { count: "exact", head: true }).eq("crew_id", crew.id).eq("period", month).in("status", ["pending", "reported"]) : Promise.resolve({ count: 0 }),
  ]);
  const bankRaw = bankRow as { opening_balance: number | string | null; opening_on: string | null } | null;
  // 숫자 열이지만 방어적으로 — NaN 이 화면에 찍히면 잔액 전체가 못 쓰게 된다
  const bank = bankRaw ? { opening_balance: Number(bankRaw.opening_balance) || 0, opening_on: bankRaw.opening_on } : null;
  // 마감된 달은 읽기 전용 — 버튼을 숨기지만 강제는 DB 트리거가 한다
  const closed = (closeRow as { closed_at: string } | null)?.closed_at ?? null;
  const entries = (rows ?? []) as LedgerRow[];
  const charges = (chargeRows ?? []) as BoardCharge[];

  const monthIncome = entries.filter((r) => r.kind === "income").reduce((a, r) => a + r.amount, 0);
  const monthExpense = entries.filter((r) => r.kind === "expense").reduce((a, r) => a + r.amount, 0);
  const all = (allRows ?? []) as { id: string; entry_date: string; created_at: string; kind: string; amount: number; settled_on: string | null }[];
  const signed = (r: { kind: string; amount: number }) => (r.kind === "income" ? r.amount : -r.amount);
  // 장부 잔액 = 기록한 모든 거래. 통장 잔고 = 기초 잔액 + 통장에 찍힌 것만.
  // 둘의 차이가 곧 "아직 통장에 안 들어온 돈"이라 대사가 된다.
  const totalBalance = all.reduce((a, r) => a + signed(r), 0);
  const settledNet = all.filter((r) => r.settled_on != null).reduce((a, r) => a + signed(r), 0);
  const bankBalance = (bank?.opening_balance ?? 0) + settledNet;
  const unsettled = totalBalance - settledNet;
  const unsettledCount = all.filter((r) => r.settled_on == null).length;
  // 이 달 미반영 건수 — 일괄 반영 버튼에 쓴다
  const monthUnsettled = entries.filter((r) => r.settled_on == null).length;

  // 행별 러닝 잔액 — 최신 거래가 곧 현재 장부 잔액이고, 아래로 내려가며 역산한다.
  // 필터와 무관하게 **전체 거래** 기준이라 목록을 걸러도 잔액이 흔들리지 않는다.
  const balanceOf = new Map<string, number>();
  let running = totalBalance;
  for (const r of all) {
    balanceOf.set(r.id, running);
    running -= signed(r);
  }
  const tableRows: LedgerTableRow[] = entries.map((r) => ({ ...r, balance: balanceOf.get(r.id) ?? 0 }));

  // 수입 KPI 부제 — 회비로 들어온 돈과 그 밖을 갈라 보여 준다
  const duesIncome = entries.filter((r) => r.kind === "income" && r.source === "dues").reduce((a, r) => a + r.amount, 0);
  const otherIncome = monthIncome - duesIncome;
  const monthNet = monthIncome - monthExpense;
  const sign = (n: number) => (n >= 0 ? "+" : "−");

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(tag, { year: "numeric", month: "long" });
  // 월을 옮겨도 보고 있던 탭이 유지되어야 한다
  const linkFor = (mm: string, vv: "ledger" | "dues" = view) => `/crews/${slug}/finance?m=${mm}` + (vv === "dues" ? "&tab=dues" : "");
  // 미래 달은 볼 이유가 없다 — 다음 달 버튼을 잠근다
  const thisMonth = todayISOIn(tz).slice(0, 7);
  const canNext = month < thisMonth;
  const bankAccount = crew.links?.bank_account ?? "";
  const duesFilter = f === "unpaid" || f === "settled" || f === "waived" ? f : ("all" as const);

  // 사이드 "확인할 일" — 이 달 미납만. 첫 미납자를 한 줄 요약으로 보여 준다.
  const openCharges = charges.filter((c) => c.status === "pending" || c.status === "reported");
  const unpaidAmount = openCharges.reduce((a, c) => a + c.amount, 0);
  const unpaidPeople = new Set(openCharges.map((c) => c.user_id)).size;
  const firstUnpaid = openCharges[0] ?? null;

  const tiers = (tierRows ?? []) as { id: string; name: string; color: string; monthly_fee: number | null; session_fee: number | null }[];
  const basisRows = tiers.flatMap((x) =>
    [x.monthly_fee ? [`${x.name} · ${t("crew.tierMonthly")}`, won(x.monthly_fee)] : null, x.session_fee ? [`${x.name} · ${t("crew.tierSession")}`, won(x.session_fee)] : null].filter(
      (r): r is string[] => r != null,
    ),
  );

  const exportHead =
    view === "dues"
      ? [t("crew.colMember"), t("crew.colTier"), t("crew.finColDesc"), t("crew.finAmount"), t("crew.duesSettled")]
      : [t("crew.finColDate"), t("crew.finKindAll"), t("crew.finCategory"), t("crew.finColDesc"), t("crew.finAmount"), t("crew.finTotalBalance"), t("crew.finMemo")];
  const exportRows =
    view === "dues"
      ? charges.map((c) => [c.display_name, c.tier_name ?? "", c.label, c.amount, c.status])
      : tableRows.map((r) => [
          r.entry_date,
          t(r.kind === "income" ? "crew.finKindIncome" : "crew.finKindExpense"),
          r.category ? t(categoryDictKey(r.category)) : "",
          r.title,
          r.kind === "income" ? r.amount : -r.amount,
          r.balance,
          r.memo ?? "",
        ]);

  return (
    <div className="rx-finance">
      <div className="rx-subhead">
        <div>
          <h2>{t("crew.finHero")}</h2>
          <p>
            {monthLabel} · {crew.name}
            {closed && ` · ${t("crew.finMonthClosed")}`}
          </p>
        </div>
        <div className="rx-actions" style={{ marginTop: 0 }}>
          <Button asChild variant="outline" size="icon">
            <Link href={linkFor(shiftMonth(month, -1))} aria-label={t("crew.prevMonth")}>
              <ChevronLeft size={18} />
            </Link>
          </Button>
          {canNext ? (
            <Button asChild variant="outline" size="icon">
              <Link href={linkFor(shiftMonth(month, 1))} aria-label={t("crew.nextMonth")}>
                <ChevronRight size={18} />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="icon" disabled aria-label={t("crew.nextMonth")}>
              <ChevronRight size={18} />
            </Button>
          )}
          <CrewFinanceExport filename={`${slug}-${month}-${view}.csv`} head={exportHead} rows={exportRows} />
          <CrewMonthClose crewId={crew.id} period={month} periodLabel={monthLabel} closedOn={closed} canEdit={isStaff} unpaidCount={unpaidCount ?? 0} />
        </div>
      </div>

      <Stats
        items={[
          [t("crew.finIncome"), `+${won(monthIncome)}`, t("crew.finIncomeSub", { dues: won(duesIncome), other: won(otherIncome) })],
          [t("crew.finExpense"), `−${won(monthExpense)}`, t("crew.finEntryN", { n: entries.filter((r) => r.kind === "expense").length })],
          [t("crew.finMonthNet"), `${sign(monthNet)}${won(monthNet)}`, t("crew.finNetSub")],
          [t("crew.finBalance"), won(totalBalance), t("crew.finBalanceSub", { opening: won(bank?.opening_balance ?? 0) })],
        ]}
      />

      <div className="rx-finance-tabs">
        {isStaff ? (
          <QuerySegments
            label={t("crew.financeTab")}
            param="tab"
            value={view}
            defaultValue="ledger"
            options={[
              ["ledger", `${t("crew.finTabLedger")} ${entries.length}`],
              ["dues", unpaidCount ? `${t("crew.finTabDues")} · ${t("crew.duesFltUnpaid")} ${unpaidCount}` : t("crew.finTabDues")],
            ]}
          />
        ) : (
          <Chip>{t("crew.finTabLedger")}</Chip>
        )}
        <span>
          <Lock size={14} />
          {t(isStaff ? "crew.finVisibility" : "crew.finVisibilityRead")}
          {closed && ` · ${t("crew.finClosedNote", { period: monthLabel })}`}
        </span>
      </div>

      <div className="rx-finance-layout">
        <div className="rx-finance-content">
          {view === "dues" ? (
            <CrewDuesMatrix crewId={crew.id} period={month} periodLabel={monthLabel} charges={charges} locked={closed != null} initialFilter={duesFilter} />
          ) : (
            <CrewLedgerTable rows={tableRows} crewId={crew.id} today={todayISOIn(tz)} isStaff={isStaff} closed={closed != null} monthLabel={monthLabel} locale={tag} />
          )}
        </div>

        <aside className="rx-finance-aside" aria-label={t("crew.financeTab")}>
          {/* 확인할 일 — 이 달 미납. 누르면 목록이 미납만 남는다(?f=unpaid). 시안에 없음(§4) — rx-notice */}
          {view === "dues" && unpaidAmount > 0 && (
            <div className="rx-notice">
              <div>
                <b>{t("crew.duesTodo")}</b>
                <p>
                  {t("crew.duesTodoSum", { n: unpaidPeople, amount: won(unpaidAmount) })}
                  {firstUnpaid && (
                    <>
                      <br />
                      {firstUnpaid.display_name} — {firstUnpaid.label}
                    </>
                  )}
                </p>
                <div className="rx-actions">
                  <Go href={`${linkFor(month, "dues")}&f=unpaid`} primary>
                    {t("crew.duesOpenUnpaid")}
                  </Go>
                  {/* 독촉은 운영진만. 크론이 아니라 눌러야 나간다 */}
                  {isStaff && <CrewDuesNotify crewId={crew.id} period={month} count={unpaidPeople} />}
                </div>
              </div>
            </div>
          )}
          {view === "ledger" && isStaff && !closed && <CrewLedgerForm crewId={crew.id} today={todayISOIn(tz)} trigger="inline" />}
          {view === "ledger" && <CrewExpenseMix rows={entries} periodLabel={monthLabel} />}

          {/* 크루 계좌 — 시안 BankSummary 그대로. 장부와 통장의 차이가 곧 미반영 금액이다 */}
          <Panel title={t("crew.finBank")} action={<Landmark size={18} />} className="rx-finance-bank">
            <Chip tone={unsettledCount ? "yellow" : "green"}>
              {unsettledCount ? (
                t("crew.finBankDiff", { amount: won(Math.abs(unsettled)) })
              ) : (
                <>
                  <Check size={13} />
                  {t("crew.finLedgerMatch")}
                </>
              )}
            </Chip>
            <span className="rx-finance-bank-label">{t("crew.finSettledBasis")}</span>
            <strong className="rx-finance-bank-balance">{won(bankBalance)}</strong>
            <dl>
              <div>
                <dt>{t("crew.finOpening")}</dt>
                <dd>{won(bank?.opening_balance ?? 0)}</dd>
              </div>
              <div>
                <dt>{t("crew.finAllTimeNet")}</dt>
                <dd>
                  {sign(totalBalance)}
                  {won(totalBalance)}
                </dd>
              </div>
              <div>
                <dt>{t("crew.finUnsettledTx")}</dt>
                <dd>{won(unsettled)}</dd>
              </div>
            </dl>
            {bankAccount && <p className="rx-finance-account">{bankAccount}</p>}
            {isStaff && (
              <>
                <CrewBankOpening crewId={crew.id} openingBalance={bank?.opening_balance ?? 0} openingOn={bank?.opening_on ?? null} />
                {monthUnsettled > 0 && <CrewLedgerSettleMonth crewId={crew.id} from={from} to={to} count={monthUnsettled} />}
              </>
            )}
            <Hint>{t("crew.finCurrentBalance")}</Hint>
          </Panel>

          {/* 이 달 청구 기준 — 시안 BillingBasis. 등급이 곧 요금표다 */}
          {view === "dues" && basisRows.length > 0 && (
            <Panel title={t("crew.finBasisTitle", { period: monthLabel })} className="rx-finance-basis">
              <dl>
                {basisRows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/crews/${slug}/manage?tab=dues`}>
                {t("crew.finBasisManage")}
                <ArrowRight size={15} />
              </Link>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
