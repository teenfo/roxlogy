import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShort, formatMs } from "@/lib/format";
import { RunLapLine } from "@/components/charts";
import { ExerciseDrills, type Drill } from "@/components/exercise-drills";

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
  const { t, tag, locale } = await getT();

  const { data: ex } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!ex) notFound();

  // 이 운동에 대한 내 세션 스플릿 추이 (RLS: 본인 세그먼트만 조회됨)
  const { data: segRows } = await supabase
    .from("session_segments")
    .select("split_time_ms, sessions!inner ( started_at, deleted_at )")
    .eq("exercise_id", id)
    .not("split_time_ms", "is", null)
    .is("sessions.deleted_at", null);
  type SegRow = {
    split_time_ms: number;
    sessions: { started_at: string } | null;
  };
  const splits = ((segRows ?? []) as unknown as SegRow[])
    .filter((r) => r.sessions?.started_at)
    .sort(
      (a, b) =>
        new Date(a.sessions!.started_at).getTime() -
        new Date(b.sessions!.started_at).getTime(),
    )
    .slice(-15);
  const trend = splits.map((r) => ({
    name: formatDateShort(r.sessions!.started_at, tag),
    ms: r.split_time_ms,
  }));
  const best = splits.length
    ? Math.min(...splits.map((r) => r.split_time_ms))
    : null;
  const latest = splits.length ? splits[splits.length - 1].split_time_ms : null;

  // 이 운동에 대해 내가 직접 추가한 도움 훈련 (RLS: 본인 것만)
  const { data: drillRows } = await supabase
    .from("exercise_drills")
    .select("id, title, body")
    .eq("exercise_id", id)
    .order("created_at", { ascending: true });
  const drills = (drillRows ?? []) as Drill[];

  const muscles: string[] = Array.isArray(ex.muscles) ? ex.muscles : [];
  const helps: string[] = Array.isArray(ex.helps_stations)
    ? ex.helps_stations
    : [];

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

      {muscles.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm text-muted">{t("exercises.detTarget")}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {muscles.map((m) => (
              <span
                key={m}
                className="rounded-full bg-track/15 px-3 py-1 text-xs font-semibold text-track"
              >
                {t(`muscle.${m}` as Parameters<typeof t>[0])}
              </span>
            ))}
          </div>
        </section>
      )}

      {helps.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm text-muted">{t("exercises.detHelps")}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {helps.map((h) => (
              <span
                key={h}
                className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent"
              >
                {t(`hstation.${h}` as Parameters<typeof t>[0])}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">{t("exercises.detHelpsHint")}</p>
        </section>
      )}

      {trend.length >= 2 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{t("exercises.myTrend")}</h2>
            <span className="text-xs text-muted">
              {t("exercises.trendBestLatest", {
                best: best != null ? formatMs(best) : "—",
                latest: latest != null ? formatMs(latest) : "—",
              })}
            </span>
          </div>
          <div className="mt-3 rounded-md bg-surface p-4">
            <RunLapLine data={trend} />
          </div>
          <p className="mt-2 text-xs text-muted">{t("exercises.trendNote")}</p>
        </section>
      )}

      {ex.description_ko && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{t("exercises.detHowTo")}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
            {ex.description_ko}
          </p>
        </section>
      )}

      <ExerciseDrills exerciseId={id} initial={drills} />
    </main>
  );
}
