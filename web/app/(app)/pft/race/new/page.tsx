import { getT } from "@/lib/i18n";
import { RaceNewScreen } from "@/components/race-screens";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.create") };
}

export default function Page() {
  return <RaceNewScreen format="pft" />;
}
