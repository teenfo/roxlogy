import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMs } from "@/lib/format";

export const metadata: Metadata = { title: "레이스 — Roxlogy" };

const DIVISION_LABEL: Record<string, string> = {
  open: "오픈",
  pro: "프로",
  doubles: "더블",
  pro_doubles: "프로 더블",
  relay: "릴레이",
};

export default async function RacesPage() {
  const supabase = await createClient();
  const { data: races } = await supabase
    .from("race_results")
    .select("id, event, event_date, division, total_time_ms")
    .order("event_date", { ascending: false });

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">레이스</h1>
        <Link
          href="/races/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          결과 등록
        </Link>
      </div>

      <section className="mt-4 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm">
        <p className="font-semibold">공식 결과 찾기</p>
        <p className="mt-1 text-muted">
          공식 결과 사이트에서 이름으로 본인 기록을 검색한 뒤, 여기에 등록해
          훈련 기록과 비교하세요. 자동 연동은 준비 중입니다.
        </p>
        <a
          href="https://results.hyrox.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-track hover:underline"
        >
          results.hyrox.com에서 내 결과 검색 →
        </a>
      </section>

      {!races?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          등록된 레이스 결과가 없습니다. 첫 결과를 등록해 보세요.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {races.map((r) => (
            <li key={r.id}>
              <Link
                href={`/races/${r.id}`}
                className="flex items-center justify-between rounded-md bg-surface px-4 py-3.5 hover:bg-surface/70"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{r.event}</span>
                  <span className="text-xs text-muted">
                    {r.event_date ?? "날짜 미입력"} ·{" "}
                    {DIVISION_LABEL[r.division ?? ""] ?? r.division ?? "—"}
                  </span>
                </div>
                <span className="font-mono text-lg font-semibold text-accent">
                  {formatMs(r.total_time_ms)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
