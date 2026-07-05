import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMs, SOURCE_DEVICE_LABEL } from "@/lib/format";

const PAGE_SIZE = 20;

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { data: sessions, count } = await supabase
    .from("sessions")
    .select("id, started_at, total_time_ms, source_device, analysis_status", {
      count: "exact",
    })
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main>
      <h1 className="text-2xl font-bold">세션 히스토리</h1>
      <p className="mt-1 text-sm text-muted">총 {total}개</p>

      {!sessions?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          기록된 세션이 없습니다.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sessions/${s.id}`}
                className="flex items-center justify-between rounded-md bg-surface px-4 py-3.5 hover:bg-surface/70"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm">{formatDate(s.started_at)}</span>
                  <span className="text-xs text-muted">
                    {SOURCE_DEVICE_LABEL[s.source_device] ?? s.source_device}
                    {s.analysis_status !== "done" && " · 분석 대기중"}
                  </span>
                </div>
                <span className="font-mono text-lg font-semibold">
                  {formatMs(s.total_time_ms)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="mt-6 flex justify-center gap-4 text-sm">
          {page > 1 && (
            <Link href={`/sessions?page=${page - 1}`} className="text-accent">
              ← 이전
            </Link>
          )}
          <span className="text-muted">
            {page} / {lastPage}
          </span>
          {page < lastPage && (
            <Link href={`/sessions?page=${page + 1}`} className="text-accent">
              다음 →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
