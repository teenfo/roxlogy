import { getT } from "@/lib/i18n";
import { ProgramNewForm } from "@/components/program-new-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.programNew") };
}

export default function ProgramNewPage() {
  return <ProgramNewForm />;
}
