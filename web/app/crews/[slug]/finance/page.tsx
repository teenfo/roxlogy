import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { isFullMember } from "@/lib/crew-types";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { todayISOIn } from "@/lib/format";
import {
  CrewLedgerDelete,
  CrewLedgerForm,
} from "@/components/crew-ledger-form";
import { CrewDuesMatrix, type BoardCharge } from "@/components/crew-dues-check";
import { Badge, Card, Chip, SectionHead } from "@/components/ui/crew-ui";

type LedgerRow = {
  id: string;
  entry_date: string;
  kind: "income" | "expense";
  amount: number;
  title: string;
  source: string | null;
  memo: string | null;
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
  searchParams: Promise<{ m?: string; tab?: string }>;
}) {
  const { slug } = await params;
  const { m, tab } = await searchParams;

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

  if (!isFull) {
    return (
      <main>
        <Card className="px-4 py-10 text-center">
          <p className="text-sm text-muted">{t("crew.finFullOnly")}</p>
        </Card>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: rows }, { data: allRows }, { data: chargeRows }] =
    await Promise.all([
      supabase
        .from("crew_ledger")
        .select("id, entry_date, kind, amount, title, memo, source")
        .eq("crew_id", crew.id)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      // 누적 잔액용 전체 합계 (kind별 sum)
      supabase
        .from("crew_ledger")
        .select("kind, amount")
        .eq("crew_id", crew.id),
      // 회비 청구 보드 (운영진만 — RPC 가 스태프를 검증)
      isStaff && view === "dues"
        ? supabase.rpc("crew_dues_board", { p_slug: slug, p_period: month })
        : Promise.resolve({ data: null }),
    ]);
  const entries = (rows ?? []) as LedgerRow[];
  const charges = (chargeRows ?? []) as BoardCharge[];

  const monthIncome = entries
    .filter((r) => r.kind === "income")
    .reduce((a, r) => a + r.amount, 0);
  const monthExpense = entries
    .filter((r) => r.kind === "expense")
    .reduce((a, r) => a + r.amount, 0);
  const totalBalance = (allRows ?? []).reduce(
    (a, r) => a + (r.kind === "income" ? r.amount : -r.amount),
    0,
  );

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(tag, {
    year: "numeric",
    month: "long",
  });
  // 월을 옮겨도 보고 있던 탭이 유지되어야 한다
  const linkFor = (mm: string, vv: "ledger" | "dues" = view) =>
    `/crews/${slug}/finance?m=${mm}${vv === "dues" ? "&tab=dues" : ""}`;
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(tag, {
      month: "short",
      day: "numeric",
    });

  // 날짜별 그룹 — 하루 합계를 머리글에 얹어 그날 돈이 어떻게 움직였는지 보이게
  const byDate = new Map<string, LedgerRow[]>();
  for (const r of entries) {
    const arr = byDate.get(r.entry_date) ?? [];
    arr.push(r);
    byDate.set(r.entry_date, arr);
  }
  const dayNet = (rs: LedgerRow[]) =>
    rs.reduce((a, r) => a + (r.kind === "income" ? r.amount : -r.amount), 0);

  return (
    <main>
      {/* 툴바 — 월 이동 + 장부/회비 세그먼트 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-[10px] border border-line-mid bg-control">
          <Link
            href={linkFor(shiftMonth(month, -1))}
            aria-label={t("crew.prevMonth")}
            className="flex h-9 w-9 items-center justify-center rounded-l-[10px] text-accent hover:bg-card-hover"
          >
            ‹
          </Link>
          <span className="tabular px-2 text-sm font-bold">{monthLabel}</span>
          <Link
            href={linkFor(shiftMonth(month, 1))}
            aria-label={t("crew.nextMonth")}
            className="flex h-9 w-9 items-center justify-center rounded-r-[10px] text-accent hover:bg-card-hover"
          >
            ›
          </Link>
        </div>
        {isStaff && (
          <nav className="flex gap-1.5">
            {(["ledger", "dues"] as const).map((v) => (
              <Chip key={v} href={linkFor(month, v)} active={view === v}>
                {t(v === "ledger" ? "crew.finTabLedger" : "crew.finTabDues")}
              </Chip>
            ))}
          </nav>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted">
          {t("crew.finNote")}
        </span>
      </div>

      {/* 요약 4카드 — 누적 잔액만 강조 */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="px-4 py-3.5">
          <p className="text-xs text-muted">{t("crew.finIncome")}</p>
          <p className="tabular mt-1 text-xl font-extrabold text-info">
            +{won(monthIncome)}
          </p>
        </Card>
        <Card className="px-4 py-3.5">
          <p className="text-xs text-muted">{t("crew.finExpense")}</p>
          <p className="tabular mt-1 text-xl font-extrabold text-danger">
            −{won(monthExpense)}
          </p>
        </Card>
        <Card className="px-4 py-3.5">
          <p className="text-xs text-muted">{t("crew.finMonthNet")}</p>
          <p className="tabular mt-1 text-xl font-extrabold">
            {won(monthIncome - monthExpense)}
          </p>
        </Card>
        <Card highlight className="px-4 py-3.5">
          <p className="text-xs text-muted">{t("crew.finTotalBalance")}</p>
          <p className="tabular mt-1 text-xl font-extrabold text-accent">
            {won(totalBalance)}
          </p>
        </Card>
      </section>

      {/* 회비 청구·확정 — 운영진 전용, 보고 있는 달 기준 */}
      {view === "dues" && (
        <section className="mt-6">
          <SectionHead
            title={t("crew.duesCheckTitle")}
            right={<span className="text-xs text-muted">{monthLabel}</span>}
          />
          <CrewDuesMatrix
            crewId={crew.id}
            period={month}
            periodLabel={monthLabel}
            charges={charges}
          />
        </section>
      )}

      {view === "ledger" && (
        <>
          {isStaff && (
            <div className="mt-5">
              <CrewLedgerForm crewId={crew.id} />
            </div>
          )}

          {!entries.length ? (
            <Card className="mt-6 px-4 py-10 text-center">
              <p className="text-sm text-muted">{t("crew.finEmpty")}</p>
            </Card>
          ) : (
            <div className="mt-6 flex flex-col gap-4">
              {[...byDate.keys()].map((d) => {
                const rs = byDate.get(d)!;
                const net = dayNet(rs);
                return (
                  <section key={d}>
                    <div className="mb-1.5 flex items-baseline gap-2 px-1">
                      <span className="text-sm font-extrabold">
                        {dayLabel(d)}
                      </span>
                      <span className="text-xs text-muted">
                        {t("crew.finEntryN", { n: rs.length })}
                      </span>
                      <span
                        className={`tabular ml-auto text-sm font-bold ${
                          net >= 0 ? "text-info" : "text-danger"
                        }`}
                      >
                        {net >= 0 ? "+" : "−"}
                        {won(Math.abs(net))}
                      </span>
                    </div>
                    <Card className="divide-y divide-line overflow-hidden">
                      {rs.map((r) => (
                        <div
                          key={r.id}
                          className="flex min-w-0 items-center gap-3 px-5 py-3 transition-colors hover:bg-card-hover"
                        >
                          <Badge tone={r.kind === "income" ? "info" : "danger"}>
                            {r.kind === "income"
                              ? t("crew.finKindIncome")
                              : t("crew.finKindExpense")}
                          </Badge>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {r.source === "dues"
                                ? t("crew.duesEntry", { detail: r.title })
                                : r.title}
                            </span>
                            {r.memo && (
                              <span className="block truncate text-[13px] text-muted">
                                {r.memo}
                              </span>
                            )}
                          </span>
                          <span
                            className={`tabular shrink-0 text-[15px] font-extrabold ${
                              r.kind === "income" ? "text-info" : "text-danger"
                            }`}
                          >
                            {r.kind === "income" ? "+" : "−"}
                            {won(r.amount)}
                          </span>
                          {isStaff && <CrewLedgerDelete id={r.id} />}
                        </div>
                      ))}
                    </Card>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
