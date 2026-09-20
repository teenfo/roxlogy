import { notFound } from "next/navigation";
import { Dumbbell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { dictLabel } from "@/lib/dict-label";
import { formatDateShort, formatMs } from "@/lib/format";
import { RunLapLine } from "@/components/charts";
import { ExerciseDrills, type Drill } from "@/components/exercise-drills";
import { Back, Chip, Hint, PageHead, Panel } from "@/components/rox/ui";

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

/**
 * 운동 상세 — 시안 training.tsx Exercises(id) 그대로 (PORT_PLAN §3-c):
 * Back · PageHead · two-col[Panel "운동 정보"(.rx-exercise-feature · 칩 · 수행 방법 · Hint) |
 * Panel "나의 운동 메모"(= 우리 도움 훈련 ExerciseDrills)]. 영상·내 추이는 시안에 없는 우리 정보.
 */
export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag, locale, tz } = await getT();

  const [{ data: ex }, user] = await Promise.all([
    supabase.from("exercises").select("*").eq("id", id).maybeSingle(),
    getCachedUser(),
  ]);
  if (!ex) notFound();

  // 스플릿 추이와 도움 훈련은 서로 의존하지 않는다 — 순차로 두면 도쿄 왕복이 2회다.
  // 스플릿: shared 세션 세그먼트는 RLS 로 전체 공개(피드용)라 본인 필터가 필수다
  const [{ data: segRows }, { data: drillRows }] = await Promise.all([
    supabase
      .from("session_segments")
      .select("split_time_ms, sessions!inner ( user_id, started_at, deleted_at )")
      .eq("exercise_id", id)
      .not("split_time_ms", "is", null)
      .eq("sessions.user_id", user!.id)
      .is("sessions.deleted_at", null),
    supabase
      .from("exercise_drills")
      .select("id, title, body")
      .eq("exercise_id", id)
      .order("created_at", { ascending: true }),
  ]);
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
    name: formatDateShort(r.sessions!.started_at, tag, tz),
    ms: r.split_time_ms,
  }));
  const best = splits.length ? Math.min(...splits.map((r) => r.split_time_ms)) : null;
  const latest = splits.length ? splits[splits.length - 1].split_time_ms : null;

  const drills = (drillRows ?? []) as Drill[];
  const muscles: string[] = Array.isArray(ex.muscles) ? ex.muscles : [];
  const helps: string[] = Array.isArray(ex.helps_stations) ? ex.helps_stations : [];

  // 특정 유튜브 영상이면 임베드, 검색 링크면 버튼, 그 외 URL은 이미지
  const media: string | null = ex.media_url ?? null;
  const ytId = media
    ? (media.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1] ??
      null)
    : null;
  const isYtSearch = !!media && /youtube\.com\/results/.test(media);

  const primary = locale === "ko" ? ex.name_ko : ex.name_en;
  const secondary = locale === "ko" ? ex.name_en : ex.name_ko;

  // 로케일 설명 우선, 없으면 영어 → 한국어 순 폴백.
  const desc =
    (locale === "ko"
      ? ex.description_ko
      : locale === "es"
        ? ex.description_es
        : ex.description_en) ||
    ex.description_en ||
    ex.description_ko;
  const isKoFallback = !!desc && locale !== "ko" && desc === ex.description_ko;

  return (
    <>
      <Back href="/exercises" label={t("exercises.title")} />
      <PageHead title={primary} description={secondary} />
      <div className="rx-two-col">
        <Panel title={t("exercises.info")}>
          <div className="rx-exercise-feature">
            {ytId ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                title={primary}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ width: "100%", aspectRatio: "16 / 9", border: 0, borderRadius: 12 }}
              />
            ) : media && !isYtSearch ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media} alt={primary} style={{ maxWidth: "100%", borderRadius: 12 }} />
            ) : (
              <Dumbbell size={56} />
            )}
            <span>{secondary}</span>
          </div>
          <div className="rx-actions">
            {ex.category && (
              <Chip>{t(`exercises.cat.${ex.category}` as Parameters<typeof t>[0])}</Chip>
            )}
            {ex.station_type && (
              <Chip tone="yellow">
                {t("exercises.stationN", { n: ex.station_type.replace("station_", "") })}
              </Chip>
            )}
            {(ex.equipment ?? []).map((q: string) => (
              <Chip key={q}>{dictLabel(t, `equipment.${q}`, q)}</Chip>
            ))}
            {(ytId || isYtSearch) && (
              <a className="rx-external" href={media!} target="_blank" rel="noopener noreferrer">
                {ytId ? t("exercises.watchOnYoutube") : t("exercises.watchDemo")}
              </a>
            )}
          </div>
          {desc ? (
            <>
              <h3 className="rx-section-label">
                {t("exercises.detHowTo")}
                {isKoFallback ? ` · ${t("exercises.howToKoOnly")}` : ""}
              </h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{desc}</p>
            </>
          ) : null}
          {muscles.length > 0 && (
            <Hint>
              {t("exercises.detTarget")}:{" "}
              {muscles.map((m) => dictLabel(t, `muscle.${m}`, m)).join(" · ")}
            </Hint>
          )}
          {helps.length > 0 && (
            <Hint>
              {t("exercises.detHelps")}:{" "}
              {helps.map((h) => dictLabel(t, `hstation.${h}`, h)).join(" · ")} —{" "}
              {t("exercises.detHelpsHint")}
            </Hint>
          )}
        </Panel>
        <Panel>
          <div>
            <ExerciseDrills exerciseId={id} initial={drills} />
          </div>
        </Panel>
      </div>
      {trend.length >= 2 && (
        <Panel
          title={t("exercises.myTrend")}
          action={
            <Chip>
              {t("exercises.trendBestLatest", {
                best: best != null ? formatMs(best) : "—",
                latest: latest != null ? formatMs(latest) : "—",
              })}
            </Chip>
          }
        >
          <div>
            <RunLapLine data={trend} />
          </div>
          <Hint>{t("exercises.trendNote")}</Hint>
        </Panel>
      )}
    </>
  );
}
