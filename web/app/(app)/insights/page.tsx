import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("insights.title") };
}

/** AI 주간 리포트 아카이브 — 주별로 누적된 인사이트를 최신순으로 열람 */
export default async function InsightsPage() {
  const supabase = await createClient();
  const { t } = await getT();
  const user = await getCachedUser();

  const { data: rows } = await supabase
    .from("ai_insights")
    .select("id, content, model, period_start, created_at")
    .eq("user_id", user!.id)
    .eq("kind", "weekly")
    .order("created_at", { ascending: false })
    .limit(26);

  return (
    <main>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{t("insights.title")}</h1>
        <Link
          href="/dashboard"
          className="text-sm text-muted hover:text-foreground"
        >
          {t("races.back")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">{t("insights.desc")}</p>

      {!rows?.length ? (
        <p className="mt-8 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("insights.empty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-accent/25 bg-surface p-5"
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-accent">
                  {t("ai.weekly.title")}
                </h2>
                {r.period_start && (
                  <span className="text-xs text-muted">{r.period_start} ~</span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {r.content}
              </p>
              <p className="mt-3 text-xs text-muted">
                {t("ai.disclaimer")} · {r.model}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
