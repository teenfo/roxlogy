import { getT } from "@/lib/i18n";
import { SessionNewForm } from "@/components/session-new-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.sessionNew") };
}

export default function SessionNewPage() {
  return <SessionNewForm />;
}
