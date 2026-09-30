import { getT } from "@/lib/i18n";
import { RaceJoinScreen } from "@/components/race-screens";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.join") };
}

export default function Page() {
  return <RaceJoinScreen format="hyrox_sim" />;
}

