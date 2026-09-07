import { getT } from "@/lib/i18n";
import { RunForm } from "@/components/run-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("run.add") };
}

export default async function NewRunPage() {
  const { t, tz } = await getT();
  return (
    <main>
      <h1 className="text-2xl font-bold">{t("run.add")}</h1>
      <p className="mt-1 text-sm text-muted">{t("run.addDesc")}</p>
      <RunForm tz={tz} />
    </main>
  );
}
