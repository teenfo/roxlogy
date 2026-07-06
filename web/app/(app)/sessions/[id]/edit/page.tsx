import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, started_at, session_segments ( id, seq, kind, exercise_id, split_time_ms )",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!session) notFound();

  const segments = ((session.session_segments ?? []) as EditableSegment[])
    .slice()
    .sort((a, b) => a.seq - b.seq);

  return (
    <SessionNewForm
      initial={{ id: session.id, startedAt: session.started_at, segments }}
    />
  );
}
