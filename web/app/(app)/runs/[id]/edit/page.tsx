import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { RunForm } from "@/components/run-form";
import type { Run } from "@/lib/run";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("run.editTitle") };
}

export default async function EditRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [{ t, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  const { data } = await supabase
    .from("runs")
    .select(
      "id, ran_on, kind, surface, distance_m, duration_ms, pace_s_per_km, incline_pct, avg_hr, max_hr, rpe, location, note",
    )
    .eq("id", id)
    .eq("user_id", user!.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data) notFound();

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("run.editTitle")}</h1>
      <RunForm initial={data as Run} tz={tz} />
    </main>
  );
}
