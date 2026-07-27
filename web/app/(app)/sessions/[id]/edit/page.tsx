import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import {
  SessionNewForm,
  type EditableSegment,
} from "@/components/session-new-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.sessionEdit") };
}

export default async function SessionEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getCachedUser();

  // 수정은 소유자만 — 관리자는 RLS 로 남의 세션도 조회되므로 명시 필터
  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, started_at, notes, rpe, template_id, division, race_result_id, leaderboard_excluded, session_segments ( id, seq, kind, exercise_id, split_time_ms )",
    )
    .eq("id", id)
    .eq("user_id", user!.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!session) notFound();

  const segments = ((session.session_segments ?? []) as EditableSegment[])
    .slice()
    .sort((a, b) => a.seq - b.seq);

  return (
    <SessionNewForm
      initial={{
        id: session.id,
        startedAt: session.started_at,
        segments,
        notes: session.notes,
        rpe: session.rpe,
        templateId: session.template_id,
        division: session.division,
        raceResultId: session.race_result_id,
        leaderboardExcluded: session.leaderboard_excluded,
      }}
    />
  );
}
