import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { isFullMember } from "@/lib/crew-types";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { todayISOIn } from "@/lib/format";
import { categoryDictKey } from "@/lib/ledger-category";
import { CrewLedgerForm } from "@/components/crew-ledger-form";
import { CrewDuesMatrix, type BoardCharge } from "@/components/crew-dues-check";
import { CrewLedgerTable, type LedgerTableRow } from "@/components/crew-ledger-table";
import { CrewFinanceExport } from "@/components/crew-finance-export";
import { CrewExpenseMix } from "@/components/crew-expense-mix";
import { CrewDuesNotify } from "@/components/crew-dues-notify";
import { Card } from "@/components/ui/crew-ui";
import { CrewBankOpening } from "@/components/crew-bank-opening";
import { CrewMonthClose } from "@/components/crew-month-close";
import { CrewLedgerSettleMonth } from "@/components/crew-ledger-settle";

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

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

/** 크루 회계 — 월별 수입/지출 내역과 합계, 누적 잔액 (멤버 전용) */
export default async function CrewFinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ m?: string; tab?: string; k?: string; f?: string }>;
}) {
  const { slug } = await params;
  const { m, tab, k, f } = await searchParams;

  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  // 기본 월은 사용자 시간대 기준. 서버의 new Date() 는 UTC 라 매월 1일 아침
  // (KST)에 지난달이 열리고, 그 상태로 "월회비 청구 생성"을 누르면 엉뚱한
  // 달에 청구가 생긴다.
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : todayISOIn(tz).slice(0, 7);
  const [from, to] = monthRange(month);

  // 회계는 정회원(리더·부리더·정회원)에게만 공개 — 일반회원(associate)·비멤버 제외
  const isFull =
    crew.my_status === "active" &&
    crew.my_role != null &&
    isFullMember(crew.my_role);
  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";
  // 회비 보드는 운영진 전용 — 일반 정회원에게는 탭이 장부 하나뿐이다
  const view: "ledger" | "dues" = isStaff && tab === "dues" ? "dues" : "ledger";
  // 수입·지출 필터. 합계는 달 전체 기준을 유지하고 목록만 걸러 낸다 —
  // 필터를 걸었다고 이 달 수입 합계가 바뀌면 그건 다른 숫자다.
  const kindFilter: "all" | "income" | "expense" =
    k === "income" || k === "expense" ? k : "all";

  if (!isFull) {
    return (
      <main className="rx-page rx-detail-page rx-crews-page">
        <Card className="rx-access px-4 py-10 text-center">
          <p className="text-sm text-muted">{t("crew.finFullOnly")}</p>
          <Link href={`/crews/${slug}`} className="rx-primary mt-5">{t("crew.about")}</Link>
        </Card>
      </main>
    );
  }

  const supabase = await createClient();
  const [
    { data: rows },
    { data: allRows },
    { data: chargeRows },
    { data: bankRow },
    { data: closeRow },
    { data: tierRows },
    { count: unpaidCount },
  ] = await Promise.all([
      supabase
        .from("crew_ledger")
        .select(
          "id, entry_date, kind, amount, title, memo, source, method, settled_on, category, dues_group",
        )
        .eq("crew_id", crew.id)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      // 누적 잔액용 전체 거래 — 합계뿐 아니라 행별 러닝 잔액도 여기서 만든다
      supabase
        .from("crew_ledger")
        .select("id, entry_date, created_at, kind, amount, settled_on")
        .eq("crew_id", crew.id)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      // 회비 청구 보드 (운영진만 — RPC 가 스태프를 검증)
      isStaff && view === "dues"
        ? supabase.rpc("crew_dues_board", { p_slug: slug, p_period: month })
        : Promise.resolve({ data: null }),
      // 통장 기초 잔액 — 정회원만 조회된다(crew_bank RLS)
      supabase
        .from("crew_bank")
        .select("opening_balance, opening_on")
        .eq("crew_id", crew.id)
        .maybeSingle(),
      // 이 달 마감 여부
      supabase
        .from("crew_month_close")
        .select("closed_at")
        .eq("crew_id", crew.id)
        .eq("period", month)
        .maybeSingle(),
      // 이 달 청구 기준 카드 — 등급이 곧 요금표다 (회비 탭에서만)
      isStaff && view === "dues"
        ? supabase
            .from("crew_member_tiers")
            .select("id, name, color, monthly_fee, session_fee")
            .eq("crew_id", crew.id)
            .is("archived_at", null)
            .order("sort_order")
        : Promise.resolve({ data: null }),
      // 마감 전 경고용 미수 건수 — 운영진만 (crew_dues_charges RLS)
      isStaff
        ? supabase
            .from("crew_dues_charges")
            .select("id", { count: "exact", head: true })
            .eq("crew_id", crew.id)
            .eq("period", month)
            .in("status", ["pending", "reported"])
        : Promise.resolve({ count: 0 }),
    ]);
  const bank = bankRow as {
    opening_balance: number;
    opening_on: string | null;
  } | null;
  // 마감된 달은 읽기 전용 — 버튼을 숨기지만 강제는 DB 트리거가 한다
  const closed = (closeRow as { closed_at: string } | null)?.closed_at ?? null;
  const entries = (rows ?? []) as LedgerRow[];
  const charges = (chargeRows ?? []) as BoardCharge[];

  const monthIncome = entries
    .filter((r) => r.kind === "income")
    .reduce((a, r) => a + r.amount, 0);
  const monthExpense = entries
    .filter((r) => r.kind === "expense")
    .reduce((a, r) => a + r.amount, 0);
  const all = (allRows ?? []) as {
    id: string;
    entry_date: string;
    created_at: string;
    kind: string;
    amount: number;
    settled_on: string | null;
  }[];
  const signed = (r: { kind: string; amount: number }) =>
    r.kind === "income" ? r.amount : -r.amount;
  // 장부 잔액 = 기록한 모든 거래. 통장 잔고 = 기초 잔액 + 통장에 찍힌 것만.
  // 둘의 차이가 곧 "아직 통장에 안 들어온 돈"이라 대사가 된다.
  const totalBalance = all.reduce((a, r) => a + signed(r), 0);
  const settledNet = all
    .filter((r) => r.settled_on != null)
    .reduce((a, r) => a + signed(r), 0);
  const bankBalance = (bank?.opening_balance ?? 0) + settledNet;
  const unsettled = totalBalance - settledNet;
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
  const tableRows: LedgerTableRow[] = entries.map((r) => ({
    ...r,
    balance: balanceOf.get(r.id) ?? 0,
  }));

  // 수입 KPI 부제 — 회비로 들어온 돈과 그 밖을 갈라 보여 준다
  const duesIncome = entries
    .filter((r) => r.kind === "income" && r.source === "dues")
    .reduce((a, r) => a + r.amount, 0);
  const otherIncome = monthIncome - duesIncome;
  const monthNet = monthIncome - monthExpense;

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(tag, {
    year: "numeric",
    month: "long",
  });
  // 월을 옮겨도 보고 있던 탭이 유지되어야 한다
  const linkFor = (
    mm: string,
    vv: "ledger" | "dues" = view,
    kk: "all" | "income" | "expense" = kindFilter,
  ) =>
    `/crews/${slug}/finance?m=${mm}` +
    (vv === "dues" ? "&tab=dues" : "") +
    (kk === "all" ? "" : `&k=${kk}`);
  // 미래 달은 볼 이유가 없다 — 다음 달 버튼을 잠근다
  const thisMonth = todayISOIn(tz).slice(0, 7);
  const canNext = month < thisMonth;
  const bankAccount = crew.links?.bank_account ?? "";
  const duesFilter =
    f === "unpaid" || f === "settled" || f === "waived" ? f : ("all" as const);

  // 사이드 "확인할 일" — 이 달 미납만. 첫 미납자를 한 줄 요약으로 보여 준다.
  const openCharges = charges.filter(
    (c) => c.status === "pending" || c.status === "reported",
  );
  const unpaidAmount = openCharges.reduce((a, c) => a + c.amount, 0);
  const unpaidPeople = new Set(openCharges.map((c) => c.user_id)).size;
  const firstUnpaid = openCharges[0] ?? null;

  const tiers = (tierRows ?? []) as {
    id: string;
    name: string;
    color: string;
    monthly_fee: number | null;
    session_fee: number | null;
  }[];

  /** 하위 탭 — 밑줄형. 회비 탭은 운영진에게만 있다. */
  const subTab = (v: "dues" | "ledger", label: string, badge: React.ReactNode) => (
    <Link
      key={v}
      href={linkFor(month, v)}
      aria-current={view === v}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-sm ${
        view === v
          ? "border-accent font-bold text-accent-ink"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {label}
      {badge}
    </Link>
  );

  /** 확인할 일 — 이 달 미납. 누르면 목록이 미납만 남는다(?f=unpaid).
   *  좁은 화면에서는 본문 위로 올린다 — 사이드가 아래로 떨어지면 제일 먼저 볼 것이
   *  제일 마지막에 오게 된다. */
  const todoCard =
    view === "dues" && unpaidAmount > 0 ? (
      <div className="flex flex-col gap-2 rounded-[14px] border border-danger-line bg-danger-card px-[18px] py-3.5">
        <p className="text-[11px] font-extrabold tracking-[0.08em] text-danger">
          {t("crew.duesTodo")}
        </p>
        <p className="text-base font-extrabold">
          {t("crew.duesTodoSum", { n: unpaidPeople, amount: won(unpaidAmount) })}
        </p>
        {firstUnpaid && (
          <p className="text-[13px] text-foreground/80">
            {firstUnpaid.display_name} — {firstUnpaid.label}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${linkFor(month, "dues")}&f=unpaid`}
            className="flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg bg-danger px-3 text-[13px] font-extrabold text-on-accent hover:brightness-110"
          >
            {t("crew.duesOpenUnpaid")}
          </Link>
          {/* 독촉은 운영진만. 크론이 아니라 눌러야 나간다 */}
          {isStaff && (
            <CrewDuesNotify crewId={crew.id} period={month} count={unpaidPeople} />
          )}
        </div>
      </div>
    ) : null;

  /** 크루 통장 — 두 탭 모두 우측에 붙는다. 장부와 통장의 차이가 곧 미반영 금액이다. */
  const bankCard = (
    <div className="rx-bank flex flex-col gap-2 rounded-[14px] border border-line bg-card px-[18px] py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-extrabold">{t("crew.finBank")}</p>
        <span
          className={`shrink-0 text-[11px] font-bold ${
            unsettled === 0 ? "text-success" : "text-danger"
          }`}
        >
          {unsettled === 0
            ? `✓ ${t("crew.finLedgerMatch")}`
            : t("crew.finBankDiff", { amount: won(Math.abs(unsettled)) })}
        </span>
      </div>
      <p className="text-xs text-muted">{t("crew.finCurrentBalance")}</p>
      <p className="tabular text-[26px] font-extrabold leading-tight">{won(bankBalance)}</p>
      <dl className="flex flex-col gap-1 border-t border-line pt-2.5 text-[13px]">
        {[
          [t("crew.finOpening"), won(bank?.opening_balance ?? 0)],
          [
            t("crew.finAllTimeNet"),
            `${totalBalance >= 0 ? "+" : "−"}${won(Math.abs(totalBalance))}`,
          ],
          [t("crew.finUnsettledTx"), won(unsettled)],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {bankAccount && (
        <p className="break-all text-xs text-muted">{bankAccount}</p>
      )}
      {isStaff && (
        <div className="flex flex-wrap gap-2">
          <CrewBankOpening
            crewId={crew.id}
            openingBalance={bank?.opening_balance ?? 0}
            openingOn={bank?.opening_on ?? null}
          />
          {monthUnsettled > 0 && (
            <CrewLedgerSettleMonth
              crewId={crew.id}
              from={from}
              to={to}
              count={monthUnsettled}
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <main className="rx-page rx-detail-page rx-crews-page flex flex-col gap-5">
      {/* ── §0 월 헤더 ── */}
      <div className="flex flex-wrap items-center gap-3.5">
        <h1 className="text-[22px] font-extrabold">{monthLabel}</h1>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            closed ? "bg-line text-muted" : "bg-success-bg text-success"
          }`}
        >
          {closed ? t("crew.finMonthClosed") : `● ${t("crew.finMonthOpen")}`}
        </span>
        <span className="flex items-center rounded-full border border-line-mid bg-control">
          <Link
            href={linkFor(shiftMonth(month, -1))}
            aria-label={t("crew.prevMonth")}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-accent-ink hover:bg-card-hover"
          >
            ‹
          </Link>
          <span className="tabular px-2 text-[13px] font-bold">{month.replace("-", " ")}</span>
          {canNext ? (
            <Link
              href={linkFor(shiftMonth(month, 1))}
              aria-label={t("crew.nextMonth")}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-accent-ink hover:bg-card-hover"
            >
              ›
            </Link>
          ) : (
            <span
              aria-hidden
              className="flex h-[30px] w-[30px] items-center justify-center text-muted-3"
            >
              ›
            </span>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <CrewFinanceExport
            filename={`${slug}-${month}-${view}.csv`}
            head={
              view === "dues"
                ? [
                    t("crew.colMember"),
                    t("crew.colTier"),
                    t("crew.finColDesc"),
                    t("crew.finAmount"),
                    t("crew.duesSettled"),
                  ]
                : [
                    t("crew.finColDate"),
                    t("crew.finKindAll"),
                    t("crew.finCategory"),
                    t("crew.finColDesc"),
                    t("crew.finAmount"),
                    t("crew.finTotalBalance"),
                    t("crew.finMemo"),
                  ]
            }
            rows={
              view === "dues"
                ? charges.map((c) => [
                    c.display_name,
                    c.tier_name ?? "",
                    c.label,
                    c.amount,
                    c.status,
                  ])
                : tableRows.map((r) => [
                    r.entry_date,
                    t(r.kind === "income" ? "crew.finKindIncome" : "crew.finKindExpense"),
                    r.category ? t(categoryDictKey(r.category)) : "",
                    r.title,
                    r.kind === "income" ? r.amount : -r.amount,
                    r.balance,
                    r.memo ?? "",
                  ])
            }
          />
          <CrewMonthClose
            crewId={crew.id}
            period={month}
            periodLabel={monthLabel}
            closedOn={closed}
            canEdit={isStaff}
            unpaidCount={unpaidCount ?? 0}
          />
        </div>
      </div>

      {closed && (
        <p className="rounded-[10px] bg-label-bg px-3 py-2 text-xs font-semibold text-label">
          {t("crew.finClosedNote", { period: monthLabel })}
        </p>
      )}

      {/* ── §0 KPI 4 ── */}
      <section className="rx-finance-kpis grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card className="px-[18px] py-3.5">
          <p className="text-xs text-muted">{t("crew.finIncome")}</p>
          <p className="tabular mt-1 text-[22px] font-extrabold leading-tight text-info md:text-[26px]">
            +{won(monthIncome)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {t("crew.finIncomeSub", { dues: won(duesIncome), other: won(otherIncome) })}
          </p>
        </Card>
        <Card className="px-[18px] py-3.5">
          <p className="text-xs text-muted">{t("crew.finExpense")}</p>
          <p className="tabular mt-1 text-[22px] font-extrabold leading-tight text-danger md:text-[26px]">
            −{won(monthExpense)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {t("crew.finEntryN", { n: entries.filter((r) => r.kind === "expense").length })}
          </p>
        </Card>
        <Card className="px-[18px] py-3.5">
          <p className="text-xs text-muted">{t("crew.finMonthNet")}</p>
          <p
            className={`tabular mt-1 text-[22px] font-extrabold leading-tight md:text-[26px] ${
              monthNet >= 0 ? "text-success" : "text-danger"
            }`}
          >
            {monthNet >= 0 ? "+" : "−"}
            {won(Math.abs(monthNet))}
          </p>
          <p className="mt-0.5 text-xs text-muted">{t("crew.finNetSub")}</p>
        </Card>
        <Card highlight className="px-[18px] py-3.5">
          <p className="text-xs text-accent-ink">{t("crew.finBalance")}</p>
          <p className="tabular mt-1 text-[22px] font-extrabold leading-tight md:text-[26px] text-accent-ink">
            {won(totalBalance)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted">
            <span>
              {t("crew.finBalanceSub", { opening: won(bank?.opening_balance ?? 0) })}
            </span>
            <span className={unsettled === 0 ? "text-success" : "text-danger"}>
              {unsettled === 0
                ? `✓ ${t("crew.finBankMatch")}`
                : t("crew.finBankDiff", { amount: won(Math.abs(unsettled)) })}
            </span>
          </p>
        </Card>
      </section>

      {/* ── §0 하위 탭 ── */}
      <nav className="flex flex-wrap items-center gap-5 border-b border-line">
        {isStaff &&
          subTab(
            "dues",
            t("crew.finTabDues"),
            unpaidCount ? (
              <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-[10px] font-bold text-danger">
                {t("crew.duesFltUnpaid")} {unpaidCount}
              </span>
            ) : null,
          )}
        {subTab(
          "ledger",
          t("crew.finTabLedger"),
          <span className="text-[11px] text-muted">{entries.length}</span>,
        )}
        <span className="ml-auto pb-2.5 text-xs text-muted">
          🔒 {t(isStaff ? "crew.finVisibility" : "crew.finVisibilityRead")}
        </span>
      </nav>

      {/* ── 본문 + 우측 사이드 ── */}
      {todoCard && <div className="min-[900px]:hidden">{todoCard}</div>}
      <div className="rx-finance-grid">
        {view === "dues" ? (
          <CrewDuesMatrix
            crewId={crew.id}
            period={month}
            periodLabel={monthLabel}
            charges={charges}
            locked={closed != null}
            initialFilter={duesFilter}
          />
        ) : (
          <CrewLedgerTable
            rows={tableRows}
            crewId={crew.id}
            today={todayISOIn(tz)}
            isStaff={isStaff}
            closed={closed != null}
            monthLabel={monthLabel}
            locale={tag}
          />
        )}

        <aside className="rx-finance-aside">
          {todoCard && <div className="hidden min-[900px]:block">{todoCard}</div>}
          {view === "ledger" && isStaff && !closed && (
            <CrewLedgerForm crewId={crew.id} today={todayISOIn(tz)} trigger="inline" />
          )}
          {view === "ledger" && (
            <CrewExpenseMix rows={entries} periodLabel={monthLabel} />
          )}
          {bankCard}

          {/* 이 달 청구 기준 — 등급이 곧 요금표다 */}
          {view === "dues" && tiers.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-card px-[18px] py-3.5">
              <p className="text-[11px] font-extrabold tracking-[0.08em] text-muted">
                {t("crew.duesBasis", { period: monthLabel })}
              </p>
              <dl className="flex flex-col gap-1 text-xs">
                {tiers.flatMap((x) =>
                  [
                    x.monthly_fee
                      ? [`${x.name} ${t("crew.tierMonthly")}`, won(x.monthly_fee)]
                      : null,
                    x.session_fee
                      ? [`${x.name} ${t("crew.tierSession")}`, won(x.session_fee)]
                      : null,
                  ].filter((r): r is string[] => r != null),
                ).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <dt className="min-w-0 truncate text-muted">{k}</dt>
                    <dd className="tabular shrink-0 font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <Link
                href={`/crews/${slug}/manage?tab=dues`}
                className="text-xs font-semibold text-accent-ink hover:underline"
              >
                {t("crew.duesFeeSettings")}
              </Link>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
