import { ArrowRight, Plus, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateOnly, formatDateShort, formatMs, todayISOIn } from "@/lib/format";
import { GoalDeleteButton } from "@/components/goal-delete-button";
import { Chip, Empty, Go, Hint, PageHead, Panel } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("goals.title") };
}

type Goal = {
  id: string;
  created_at: string;
  target_total_ms: number;
  run_total_ms: number | null;
  station_total_ms: number | null;
  roxzone_total_ms: number | null;
  level: string | null;
  division: string | null;
  event_name: string | null;
  event_date: string | null;
  stations: { key: string; targetMs: number }[] | null;
};

/**
 * 목표 — 시안 racing.tsx 의 Goals 그대로: PageHead(목표 만들기) · .rx-card-grid 의
 * .rx-goal-card(아이콘 · 칩 · 대회 · 디비전·날짜 · 목표 시간 · 스플릿 보기) · Hint.
 * 삭제 버튼과 런/스테이션/록스존 배분은 시안에 없는 우리 정보다(§4-1).
 */
export default async function GoalsPage() {
  const supabase = await createClient();
  const { t, tag, tz } = await getT();

  const { data } = await supabase
    .from("goal_plans")
    .select("*")
    .order("created_at", { ascending: false });
  const goals = (data ?? []) as Goal[];
  const today = todayISOIn(tz);
  // 다가오는 목표 = 대회 날짜가 오늘 이후인 것 중 가장 가까운 것
  const upcoming = goals
    .filter((g) => g.event_date && g.event_date >= today)
    .sort((a, b) => a.event_date!.localeCompare(b.event_date!))[0];

  return (
    <>
      <PageHead
        title={t("goals.title")}
        description={t("goals.desc")}
        action={
          <Go href="/predict" primary>
            <Plus size={16} />
            {t("goals.new")}
          </Go>
        }
      />
      {!goals.length ? (
        <Panel>
          <Empty
            title={t("goals.empty")}
            description={t("goals.desc")}
            action={
              <Go href="/predict" primary>
                {t("goals.new")}
              </Go>
            }
          />
        </Panel>
      ) : (
        <div className="rx-card-grid">
          {goals.map((g) => {
            const isUpcoming = upcoming?.id === g.id;
            return (
              <Panel className="rx-goal-card" key={g.id}>
                <Target size={25} />
                <Chip tone={isUpcoming ? "yellow" : "neutral"}>
                  {isUpcoming ? t("goals.upcoming") : t("goals.saved")}
                </Chip>
                <h2>{g.event_name || t("goals.noEvent")}</h2>
                <p>
                  {[
                    g.division ? t(`division.${g.division}` as Parameters<typeof t>[0]) : null,
                    g.event_date ? formatDateOnly(g.event_date, tag) : null,
                    g.level ? t(`predict.level.${g.level}` as Parameters<typeof t>[0]) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <strong>{formatMs(g.target_total_ms)}</strong>
                <p>
                  {t("predict.runPerKm")}{" "}
                  {formatMs(g.run_total_ms != null ? Math.round(g.run_total_ms / 8) : null)} ·{" "}
                  {t("predict.stationSum")} {formatMs(g.station_total_ms)} ·{" "}
                  {t("predict.roxzoneBudget")} {formatMs(g.roxzone_total_ms)}
                </p>
                <div className="rx-actions">
                  <Go href={`/predict?goal=${g.id}`}>
                    {t("goals.viewSplits")} <ArrowRight size={16} />
                  </Go>
                  <GoalDeleteButton goalId={g.id} />
                </div>
                <small className="rx-muted">
                  {t("goals.savedOn", { date: formatDateShort(g.created_at, tag, tz) })}
                </small>
              </Panel>
            );
          })}
        </div>
      )}
      <Hint>{t("goals.compareHint")}</Hint>
    </>
  );
}
