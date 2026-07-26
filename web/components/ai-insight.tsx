import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

/**
 * AI 인사이트 카드 (서버 컴포넌트) — hosub 워커가 Mac LLM 으로 생성한 코멘트 표시.
 * kind: session(세션 코칭) / race(레이스 분석) / weekly(주간 리포트, refId 불필요).
 * 아직 생성 전이면 아무것도 렌더하지 않는다 (조용한 점진 노출).
 */
export async function AiInsight({
  kind,
  refId,
}: {
  kind: "session" | "race" | "weekly";
  refId?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let q = supabase
    .from("ai_insights")
    .select("content, model, created_at, period_start")
    .eq("user_id", user.id)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1);
  if (refId) q = q.eq("ref_id", refId);
  const { data } = await q.maybeSingle();
  if (!data) return null;

  const { t } = await getT();
  const title =
    kind === "weekly"
      ? t("ai.weekly.title")
      : kind === "race"
        ? t("ai.race.title")
        : t("ai.session.title");

  return (
    <section className="mt-6 rounded-lg border border-accent/25 bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-accent">
          {title}
        </h2>
        {kind === "weekly" && data.period_start && (
          <span className="text-xs text-muted">{data.period_start} ~</span>
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
        {data.content}
      </p>
      <p className="mt-3 text-xs text-muted">
        {t("ai.disclaimer")} · {data.model}
      </p>
    </section>
  );
}
