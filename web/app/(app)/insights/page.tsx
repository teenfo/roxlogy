import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { Back, Chip, Empty, Hint, PageHead, Panel } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("insights.title") };
}

/**
 * AI 주간 리포트 아카이브 — 시안 account.tsx 의 Insights 구조(PageHead + Panel)로.
 * 시안은 "분석 상태" 표 하나지만 우리는 주별 리포트가 쌓이므로 리포트마다 Panel 이다
 * (긴 글은 .rx-prose — 스펙 §03).
 */
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
    <>
      <Back href="/dashboard" label={t("nav.dashboard")} />
      <PageHead title={t("insights.title")} description={t("insights.desc")} />
      {!rows?.length ? (
        <Panel>
          <Empty title={t("insights.title")} description={t("insights.empty")} />
        </Panel>
      ) : (
        rows.map((r) => (
          <Panel
            key={r.id}
            title={t("ai.weekly.title")}
            action={r.period_start ? <Chip>{r.period_start} ~</Chip> : undefined}
          >
            <div className="rx-prose" style={{ padding: "0 24px" }}>
              <p style={{ whiteSpace: "pre-wrap" }}>{r.content}</p>
            </div>
            <Hint>
              {t("ai.disclaimer")} · {r.model}
            </Hint>
          </Panel>
        ))
      )}
    </>
  );
}
