import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { STATIONS } from "@/lib/hyrox";
import { SessionCompare, type CompareSession } from "@/components/session-compare";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("compare.title") };
}

const EX_TO_KEY = new Map(STATIONS.map((s) => [s.exerciseId, s.key]));

export default async function SessionComparePage() {
  const supabase = await createClient();
  const { t } = await getT();

  // 레이스 시뮬 세션(스테이션 세그먼트 보유) — 최근 40개, RLS로 본인 것만
  const { data: rows } = await supabase
    .from("sessions")
    .select(
      "id, started_at, total_time_ms, session_segments ( kind, exercise_id, split_time_ms )",
    )
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
    <main>
      <Link href="/sessions" className="text-sm text-muted hover:text-foreground">
        {t("sessions.title")}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t("compare.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("compare.desc")}</p>

      {sessions.length < 2 ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("compare.needMore")}
        </p>
      ) : (
        <SessionCompare sessions={sessions} stationKeys={stationKeys} />
      )}
    </main>
  );
}
