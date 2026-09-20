import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { breakdown } from "@/lib/analysis";
import { RecordCardScreen } from "@/components/rox/record-card-screen";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("share.title") };
}

/** 세션 기록 카드 — 시안 /records/share 를 세션별 라우트로 (PORT_PLAN §7-2). 소유자만. */
export default async function SessionSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag, locale, tz } = await getT();
  const user = await getCachedUser();

  const { data: session } = await supabase
    .from("sessions")
    .select(
      `id, user_id, started_at, total_time_ms, division,
       profiles ( display_name ),
       race_results ( event, division ),
       session_segments ( seq, kind, split_time_ms, exercises ( name_ko, name_en ) )`,
    )
    .eq("id", id)
    .eq("user_id", user!.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!session) notFound();

  type Seg = {
    seq: number;
    kind: "run" | "station" | "roxzone";
    split_time_ms: number | null;
    exercises: { name_ko: string; name_en: string } | null;
  };
  const segments = ((session.session_segments ?? []) as unknown as Seg[])
    .slice()
    .sort((a, b) => a.seq - b.seq);
  const share = breakdown(segments);
  const raceRaw = (session as { race_results?: unknown }).race_results;
  const race = (Array.isArray(raceRaw) ? raceRaw[0] : raceRaw) as
    | { event: string | null; division: string | null }
    | null
    | undefined;
  const profRaw = (session as { profiles?: unknown }).profiles;
  const prof = (Array.isArray(profRaw) ? profRaw[0] : profRaw) as
    | { display_name: string | null }
    | null
    | undefined;
  const divisionKey = race?.division ?? session.division;

  return (
    <RecordCardScreen
      back={{ href: `/sessions/${id}`, label: t("sessions.title") }}
      athlete={prof?.display_name?.trim() || "Athlete"}
      dateLabel={formatDate(session.started_at, tag, tz)}
      data={{
        kind: race ? t("sessions.race") : t("sessions.typeSim"),
        subtitleParts: [
          race?.event || null,
          divisionKey ? t(`division.${divisionKey}` as Parameters<typeof t>[0]) : null,
        ],
        mainLabel: t("compare.total"),
        mainValue: formatMs(session.total_time_ms),
        splits: segments
          .filter((s) => s.kind === "station" && s.split_time_ms != null)
          .slice(0, 8)
          .map((s) => ({
            label: s.exercises
              ? locale === "ko"
                ? s.exercises.name_ko
                : s.exercises.name_en
              : `${t("kind.station")} ${s.seq}`,
            value: formatMs(s.split_time_ms),
          })),
        stats: [
          { label: t("kind.run"), value: formatMs(share.runMs) },
          { label: t("kind.roxzone"), value: formatMs(share.roxzoneMs) },
        ],
      }}
    />
  );
}
