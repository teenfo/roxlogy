import { getT } from "@/lib/i18n";
import { RunForm } from "@/components/run-form";
import { Back, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("run.add") };
}

/** 시안 Runs(create) 그대로: Back · PageHead · form.rx-form-layout (RunForm) */
export default async function NewRunPage() {
  const { t, tz } = await getT();
  return (
    <>
      <Back href="/runs" label={t("run.title")} />
      <PageHead title={t("run.add")} description={t("run.newIntro")} />
      <RunForm tz={tz} />
    </>
  );
}
