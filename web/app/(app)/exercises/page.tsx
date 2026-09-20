import { ArrowRight, Dumbbell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { dictLabel } from "@/lib/dict-label";
import { RowLink } from "@/components/row-link";
import { Chip, Empty, PageHead, Panel } from "@/components/rox/ui";
import { QueryChoice, QueryFind, QuerySegments } from "@/components/rox/query-filters";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.exercises") };
}

const CATEGORIES = ["strength", "running", "conditioning", "mobility"] as const;
// 시드 04의 장비 어휘 (필터 드롭다운)
const EQUIPMENT = [
  "skierg", "rower", "sled", "kettlebell", "sandbag", "wallball", "barbell",
  "dumbbell", "pullupbar", "airbike", "treadmill", "box", "band", "medball",
  "slamball", "rope", "jumprope", "machine", "trapbar", "yoke", "dipbar",
  "foamroller", "abwheel",
] as const;

/**
 * 운동 라이브러리 — 시안 training.tsx 의 Exercises 그대로 (PORT_PLAN §3-c):
 * PageHead · Panel(툴바 Find·Choice + Segments) · .rx-list-count · .rx-card-grid(.rx-exercise-card) · Empty.
 * 필터는 쿼리스트링(서버)이다.
 */
export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; equipment?: string }>;
}) {
  const { q, category, equipment } = await searchParams;
  const { t, locale } = await getT();

  // 운동 DB 는 authenticated 전용 RLS 라 전역 캐시(무세션 클라이언트) 대상이 아니다.
  // 한 번에 받아 필터는 메모리에서 처리 — 조건이 바뀌어도 왕복은 1회.
  const supabase = await createClient();
  const { data: allExercises } = await supabase.from("exercises").select("*");
  const term = q?.trim().toLowerCase();
  const cat = (CATEGORIES as readonly string[]).includes(category ?? "") ? category! : "all";
  const eq = (EQUIPMENT as readonly string[]).includes(equipment ?? "") ? equipment! : "all";
  const exercises = (allExercises ?? []).filter((e) => {
    if (cat !== "all" && e.category !== cat) return false;
    if (eq !== "all" && !(e.equipment ?? []).includes(eq)) return false;
    if (!term) return true;
    return [e.name_ko, e.name_en].some((v) => (v ?? "").toLowerCase().includes(term));
  });
  // 표시 이름(로케일) 기준 알파벳·가나다순 정렬
  exercises.sort((a, b) =>
    String(locale === "ko" ? a.name_ko : a.name_en).localeCompare(
      String(locale === "ko" ? b.name_ko : b.name_en),
      locale,
    ),
  );

  return (
    <>
      <PageHead title={t("exercises.title")} description={t("exercises.intro")} />
      <Panel>
        <div className="rx-toolbar">
          <QueryFind param="q" value={q ?? ""} placeholder={t("exercises.searchPh")} />
          <QueryChoice
            param="equipment"
            value={eq}
            label={t("exercises.detEquipment")}
            options={[
              ["all", t("exercises.allEquipment")],
              ...EQUIPMENT.map((e) => [e, dictLabel(t, `equipment.${e}`, e)] as [string, string]),
            ]}
          />
        </div>
        <div style={{ padding: "0 24px 24px" }}>
          <QuerySegments
            param="category"
            value={cat}
            label={t("exercises.detCategory")}
            options={[
              ["all", t("exercises.allCategories")],
              ...CATEGORIES.map((c) => [c, t(`exercises.cat.${c}`)] as [string, string]),
            ]}
          />
        </div>
      </Panel>
      <p className="rx-list-count">{t("exercises.countN", { n: exercises.length })}</p>
      {exercises.length ? (
        <div className="rx-card-grid">
          {exercises.map((ex) => {
            const primary = locale === "ko" ? ex.name_ko : ex.name_en;
            const secondary = locale === "ko" ? ex.name_en : ex.name_ko;
            return (
              <RowLink key={ex.id} className="rx-exercise-card" href={`/exercises/${ex.id}`}>
                <Dumbbell size={27} />
                <span className="rx-muted">{secondary}</span>
                <h2>{primary}</h2>
                <div>
                  {ex.category && (
                    <Chip>{t(`exercises.cat.${ex.category}` as Parameters<typeof t>[0])}</Chip>
                  )}
                  {ex.station_type && (
                    <Chip tone="yellow">
                      {t("exercises.stationN", { n: ex.station_type.replace("station_", "") })}
                    </Chip>
                  )}
                  {(ex.equipment ?? []).slice(0, 2).map((e: string) => (
                    <Chip key={e}>{dictLabel(t, `equipment.${e}`, e)}</Chip>
                  ))}
                  <ArrowRight size={18} />
                </div>
              </RowLink>
            );
          })}
        </div>
      ) : (
        <Empty title={t("exercises.noResults")} description={t("exercises.intro")} />
      )}
    </>
  );
}
