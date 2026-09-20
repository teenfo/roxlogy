import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { STATIONS } from "@/lib/hyrox";
import { SessionCompare, type CompareSession } from "@/components/session-compare";
import { Back, Empty, Go, PageHead, Panel } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("compare.title") };
}

const EX_TO_KEY = new Map(STATIONS.map((s) => [s.exerciseId, s.key]));

/** 기록 비교 — 시안 records.tsx 의 Compare 구조: Back · PageHead · Panel "기록 비교" · Empty */
export default async function SessionComparePage() {
  const supabase = await createClient();
  const { t } = await getT();
  const user = await getCachedUser();

  // 레이스 시뮬 세션(스테이션 세그먼트 보유) — 최근 40개, 본인 것만
  const { data: rows } = await supabase
    .from("sessions")
    .select(
      "id, started_at, total_time_ms, session_segments ( kind, exercise_id, split_time_ms )",
    )
    .eq("user_id", user!.id)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(40);

  const sessions: CompareSession[] = (rows ?? [])
    .map((s) => {
      const segs = (s.session_segments ?? []) as {
        kind: string;
        exercise_id: string | null;
        split_time_ms: number | null;
      }[];
      const stations: Record<string, number> = {};
      for (const seg of segs) {
        if (
          seg.kind === "station" &&
          seg.exercise_id &&
          seg.split_time_ms != null
        ) {
          const key = EX_TO_KEY.get(seg.exercise_id);
          if (key) stations[key] = seg.split_time_ms;
        }
      }
      return {
        id: s.id,
        startedAt: s.started_at,
        total: s.total_time_ms,
        stations,
      };
    })
    .filter((s) => Object.keys(s.stations).length > 0);

  const stationKeys = STATIONS.map((s) => s.key);

  return (
    <>
      <Back href="/sessions" label={t("sessions.title")} />
      <PageHead title={t("compare.title")} description={t("compare.desc")} />
      {sessions.length < 2 ? (
        <Panel title={t("compare.title")}>
          <Empty
            title={t("compare.needMore")}
            description={t("compare.desc")}
            action={<Go href="/sessions/new">{t("sessions.record")}</Go>}
          />
        </Panel>
      ) : (
        <SessionCompare sessions={sessions} stationKeys={stationKeys} />
      )}
    </>
  );
}
