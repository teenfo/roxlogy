import { getT } from "@/lib/i18n";
import { RaceNewScreen } from "@/components/race-screens";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("timing.create") };
}

export default function Page() {
  return <RaceNewScreen format="hyrox_sim" />;
}

