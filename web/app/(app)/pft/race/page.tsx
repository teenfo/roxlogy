import { RaceListScreen } from "@/components/race-screens";
import { getT } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.listTitle") };
}

export default function Page() {
  return <RaceListScreen format="pft" />;
}
