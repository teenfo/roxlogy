import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { RaceNewForm } from "@/components/race-new-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.raceNew") };
}

export default async function RaceNewPage() {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("race_events")
    .select("name")
    .order("name");
  const names = [...new Set((events ?? []).map((e) => e.name))];
  return <RaceNewForm eventNames={names} />;
}
