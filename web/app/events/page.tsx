import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "대회 일정 — Roxlogy",
  description: "하이브리드 레이스 공식 대회 일정을 검색하세요.",
};

const REGION_LABEL: Record<string, string> = {
  asia: "아시아",
  europe: "유럽",
  north_america: "북미",
  south_america: "남미",
  africa: "아프리카",
  oceania: "오세아니아",
};

function formatRange(start: string | null, end: string | null, note: string | null) {
  if (!start) return note ?? "일정 미공표";
  const s = new Date(start);
  const fmt = (d: Date) =>
    d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  if (!end || end === start) return fmt(s);
  const e = new Date(end);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  return sameMonth ? `${fmt(s)} ~ ${e.getDate()}일` : `${fmt(s)} ~ ${fmt(e)}`;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string }>;
}) {
  const { q, region } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("race_events")
    .select("*")
    .order("start_date", { ascending: true, nullsFirst: false });
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},city.ilike.${term},country.ilike.${term}`);
  }
  if (region && REGION_LABEL[region]) query = query.eq("region", region);

  const { data: events } = await query;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (events ?? []).filter((e) => !e.end_date || e.end_date >= today);
  const past = (events ?? []).filter((e) => e.end_date && e.end_date < today);

  return (
    <>
      <header className="border-b border-surface">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-black tracking-widest">ROXLOGY</span>
          </Link>
          <Link href="/login" className="text-sm text-muted hover:text-foreground">
            로그인
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-bold">대회 일정</h1>
        <p className="mt-1 text-sm text-muted">
          공식 발표된 대회 일정입니다. 정확한 일정·티켓은 공식 사이트에서
          확인하세요.
        </p>

        <form method="get" className="mt-6 flex flex-wrap gap-3">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="도시·국가·대회명 검색 (예: 서울)"
            className="min-w-52 flex-1 rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <select
            name="region"
            defaultValue={region ?? ""}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="">전체 지역</option>
            {Object.entries(REGION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110"
          >
            검색
          </button>
        </form>

        {!upcoming.length && !past.length ? (
          <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
            검색 결과가 없습니다.
          </p>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-semibold">다가오는 대회</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {upcoming.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-4 py-3.5"
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          {e.name}
                          {e.country === "대한민국" && (
                            <span className="ml-2 rounded border border-accent/60 px-1.5 py-0.5 text-xs text-accent">
                              한국
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {e.city}, {e.country}
                          {e.venue ? ` · ${e.venue}` : ""} ·{" "}
                          {REGION_LABEL[e.region ?? ""] ?? ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm">
                          {formatRange(e.start_date, e.end_date, e.date_note)}
                        </p>
                        {e.official_url && (
                          <a
                            href={e.official_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-track hover:underline"
                          >
                            공식 페이지 →
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {past.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-semibold text-muted">지난 대회</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {past.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between rounded-md bg-surface/60 px-4 py-3 text-muted"
                    >
                      <span className="text-sm">
                        {e.name} — {e.city}, {e.country}
                      </span>
                      <span className="text-xs">
                        {formatRange(e.start_date, e.end_date, e.date_note)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <p className="mt-8 text-xs text-muted">
          본 일정은 공개 발표 자료를 정리한 것으로, 변경될 수 있습니다. 등록·티켓은{" "}
          <a
            href="https://hyrox.com/find-my-race/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-track hover:underline"
          >
            공식 사이트
          </a>
          에서 확인하세요.
        </p>
      </main>
    </>
  );
}
