import { getT } from "@/lib/i18n";
import { RaceListScreen } from "@/components/race-screens";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.listTitle") };
}

export default function Page() {
  return <RaceListScreen format="pft" />;
}
