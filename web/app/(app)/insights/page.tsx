import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { Empty, PageHead, Panel } from "@/components/ui/app-ui";

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
      <PageHead
        title={t("insights.title")}
        description={t("insights.desc")}
        back={{ href: "/dashboard", label: t("nav.dashboard") }}
      />

      {!rows?.length ? (
        <Empty title={t("insights.title")} description={t("insights.empty")} />
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => (
            <li key={r.id}>
              <Panel>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-gold">
                    {t("ai.weekly.title")}
                  </h2>
                  {r.period_start && (
                    <span className="text-xs text-muted">{r.period_start} ~</span>
                  )}
                </div>
                {/* 긴 글은 본문 16px / line-height 2, 최대 780px (스펙 §03) */}
                <p className="mt-3 max-w-[780px] whitespace-pre-wrap text-base leading-[2]">
                  {r.content}
                </p>
                <p className="mt-3 text-xs text-muted">
                  {t("ai.disclaimer")} · {r.model}
                </p>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
