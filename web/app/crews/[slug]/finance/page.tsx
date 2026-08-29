import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { isFullMember } from "@/lib/crew-types";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  CrewLedgerDelete,
  CrewLedgerForm,
} from "@/components/crew-ledger-form";

type LedgerRow = {
  id: string;
  entry_date: string;
  kind: "income" | "expense";
  amount: number;
  title: string;
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
  searchParams: Promise<{ m?: string }>;
}) {
  const { slug } = await params;
  const { m } = await searchParams;
  const now = new Date();
  const month =
    m && /^\d{4}-\d{2}$/.test(m)
      ? m
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [from, to] = monthRange(month);

  const [crew, { t, tag }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  // 회계는 정회원(리더·부리더·정회원)에게만 공개 — 일반회원(associate)·비멤버 제외
  const isFull =
    crew.my_status === "active" &&
    crew.my_role != null &&
    isFullMember(crew.my_role);
  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";

  if (!isFull) {
    return (
      <main>
        <p className="rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("crew.finFullOnly")}
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: rows }, { data: allRows }] = await Promise.all([
    supabase
      .from("crew_ledger")
      .select("id, entry_date, kind, amount, title, memo")
      .eq("crew_id", crew.id)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
    // 누적 잔액용 전체 합계 (kind별 sum)
    supabase.from("crew_ledger").select("kind, amount").eq("crew_id", crew.id),
  ]);
  const entries = (rows ?? []) as LedgerRow[];

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
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(tag, {
      month: "short",
      day: "numeric",
    });

  return (
    <main>
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between">
        <Link
          href={`/crews/${slug}/finance?m=${shiftMonth(month, -1)}`}
          className="text-sm text-accent hover:underline"
        >
          ←
        </Link>
        <span className="text-sm font-bold">{monthLabel}</span>
        <Link
          href={`/crews/${slug}/finance?m=${shiftMonth(month, 1)}`}
          className="text-sm text-accent hover:underline"
        >
          →
        </Link>
      </div>

      {/* 월 합계 + 누적 잔액 */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">{t("crew.finIncome")}</p>
          <p className="mt-1 font-mono text-lg font-bold text-track">
            {won(monthIncome)}
          </p>
        </div>
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">{t("crew.finExpense")}</p>
          <p className="mt-1 font-mono text-lg font-bold text-red-400">
            {won(monthExpense)}
          </p>
        </div>
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">{t("crew.finMonthNet")}</p>
          <p className="mt-1 font-mono text-lg font-bold">
            {won(monthIncome - monthExpense)}
          </p>
        </div>
        <div className="rounded-md bg-surface px-4 py-3">
          <p className="text-xs text-muted">{t("crew.finTotalBalance")}</p>
          <p className="mt-1 font-mono text-lg font-bold text-accent">
            {won(totalBalance)}
          </p>
        </div>
      </section>

      {isStaff && (
        <div className="mt-4">
          <CrewLedgerForm crewId={crew.id} />
        </div>
      )}

      {/* 내역 */}
      {!entries.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("crew.finEmpty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-1.5">
          {entries.map((r) => (
            <li
              key={r.id}
              className="flex min-w-0 items-center gap-3 rounded-md bg-surface px-4 py-3"
            >
              <span className="shrink-0 text-xs font-semibold text-muted">
                {dayLabel(r.entry_date)}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  r.kind === "income"
                    ? "bg-track/15 text-track"
                    : "bg-red-400/15 text-red-400"
                }`}
              >
                {r.kind === "income"
                  ? t("crew.finKindIncome")
                  : t("crew.finKindExpense")}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {r.title}
                {r.memo && (
                  <span className="ml-2 text-xs text-muted">{r.memo}</span>
                )}
              </span>
              <span
                className={`shrink-0 font-mono text-sm font-semibold ${
                  r.kind === "income" ? "text-track" : "text-red-400"
                }`}
              >
                {r.kind === "income" ? "+" : "−"}
                {won(r.amount)}
              </span>
              {isStaff && <CrewLedgerDelete id={r.id} />}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t("crew.finNote")}</p>
    </main>
  );
}
