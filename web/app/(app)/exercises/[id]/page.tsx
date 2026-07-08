import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { locale } = await getT();
  const { data } = await supabase
    .from("exercises")
    .select("name_ko, name_en")
    .eq("id", id)
    .maybeSingle();
  const name = data ? (locale === "ko" ? data.name_ko : data.name_en) : null;
  return { title: name ? `${name} — Roxlogy` : "Roxlogy" };
}

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, locale } = await getT();

  const { data: ex } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!ex) notFound();

  const primary = locale === "ko" ? ex.name_ko : ex.name_en;
  const secondary = locale === "ko" ? ex.name_en : ex.name_ko;

  const meta: { label: string; value: string }[] = [];
  if (ex.category)
    meta.push({
      label: t("exercises.detCategory"),
      value: t(`exercises.cat.${ex.category}` as Parameters<typeof t>[0]),
    });
  if (ex.station_type)
    meta.push({
      label: t("exercises.detStation"),
      value: t("exercises.stationN", {
        n: ex.station_type.replace("station_", ""),
      }),
    });
  if (ex.equipment?.length)
    meta.push({
      label: t("exercises.detEquipment"),
      value: ex.equipment.join(", "),
    });

  return (
    <main>
      <Link
        href="/exercises"
        className="text-sm text-muted hover:text-foreground"
      >
        {t("exercises.back")}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{primary}</h1>
      <p className="mt-1 text-sm text-muted">{secondary}</p>

      {ex.media_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ex.media_url}
          alt={primary}
          className="mt-6 max-h-80 w-full rounded-md object-cover"
        />
      )}

      {meta.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {meta.map((m) => (
            <div key={m.label} className="rounded-md bg-surface px-4 py-3">
              <dt className="text-xs text-muted">{m.label}</dt>
              <dd className="mt-1 text-sm font-semibold">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {ex.description_ko && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{t("exercises.detHowTo")}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
            {ex.description_ko}
          </p>
        </section>
      )}
    </main>
  );
}
