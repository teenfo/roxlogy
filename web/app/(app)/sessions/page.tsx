import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.sessions") };
}

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
  const { t, tag } = await getT();
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("sessions.title")}</h1>
        <Link
          href="/sessions/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          {t("sessions.record")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">{t("sessions.total", { n: total })}</p>

      {!sessions?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("sessions.empty")}
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
                  <span className="text-sm">{formatDate(s.started_at, tag)}</span>
                  <span className="text-xs text-muted">
                    {t(`source.${s.source_device}` as Parameters<typeof t>[0])}
                    {s.analysis_status !== "done" &&
                      ` · ${t("common.analysisPending")}`}
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
              {t("sessions.pagePrev")}
            </Link>
          )}
          <span className="text-muted">
            {page} / {lastPage}
          </span>
          {page < lastPage && (
            <Link href={`/sessions?page=${page + 1}`} className="text-accent">
              {t("sessions.pageNext")}
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
