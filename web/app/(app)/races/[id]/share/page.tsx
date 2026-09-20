import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDateOnly, formatMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { RecordCardScreen } from "@/components/rox/record-card-screen";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("share.title") };
}

type RaceSplits = {
  stations?: Record<string, number>;
  run_total_ms?: number;
  field_size?: number;
  rank_overall?: number;
  bib?: string;
};

/** 레이스 기록 카드 — 시안 /records/share 를 레이스별 라우트로 (PORT_PLAN §7-2). 소유자만. */
export default async function RaceSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag, locale } = await getT();
  const user = await getCachedUser();

  const [{ data: race }, { data: profile }] = await Promise.all([
    supabase
      .from("race_results")
      .select("id, event, event_date, division, total_time_ms, splits")
      .eq("id", id)
      .eq("user_id", user!.id)
      .maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", user!.id).maybeSingle(),
  ]);
  if (!race) notFound();

  const splits = (race.splits ?? {}) as RaceSplits;
  const hasStationSplits = Object.keys(splits.stations ?? {}).length > 0;

  return (
    <RecordCardScreen
      back={{ href: `/races/${id}`, label: t("races.title") }}
      athlete={profile?.display_name?.trim() || "Athlete"}
      dateLabel={race.event_date ? formatDateOnly(race.event_date, tag) : null}
      data={{
        kind: "RACE",
        subtitleParts: [
          race.event,
          race.division ? t(`division.${race.division}` as Parameters<typeof t>[0]) : null,
          splits.bib ? `BIB ${splits.bib}` : null,
        ],
        mainLabel: t("compare.total"),
        mainValue: formatMs(race.total_time_ms),
        splits: hasStationSplits
          ? STATIONS.map((st) => ({
              label: locale === "ko" ? st.nameKo.split(" ")[0] : st.nameEn,
              value:
                splits.stations?.[st.key] != null ? formatMs(splits.stations[st.key]) : "—",
            }))
          : undefined,
        stats: [
          ...(splits.run_total_ms != null
            ? [{ label: t("kind.run"), value: formatMs(splits.run_total_ms) }]
            : []),
          ...(splits.rank_overall != null && splits.field_size != null
            ? [{ label: "RANK", value: `${splits.rank_overall}/${splits.field_size}` }]
            : []),
        ],
      }}
    />
  );
}
