import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * 사용자와 무관한 전역 참조 데이터 캐시.
 *
 * exercises·race_events·race_benchmarks 는 누가 조회하든 같은 행 집합이 나오는
 * 공개/참조 테이블이라(RLS: select true 또는 authenticated 전체 허용) 요청마다
 * DB 를 다시 때릴 이유가 없다. 사용자별 데이터는 여기에 절대 넣지 말 것 —
 * 캐시는 전역이라 한 사용자의 행이 다른 사용자에게 그대로 나간다.
 */

/** 운동 DB 전체 (관리자 수정 시에만 변함). */
export const getExercises = unstable_cache(
  async () => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("exercises")
      .select("*")
      .order("station_type", { ascending: true, nullsFirst: false })
      .order("name_en", { ascending: true });
    return data ?? [];
  },
  ["exercises-all"],
  { revalidate: 3600, tags: ["exercises"] },
);

/** 공개 대회 일정. */
export const getRaceEvents = unstable_cache(
  async () => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("race_events")
      .select("*")
      .order("start_date", { ascending: true });
    return data ?? [];
  },
  ["race-events-all"],
  { revalidate: 3600, tags: ["race_events"] },
);

/** 백분위 분포 (배치로만 갱신). */
export const getRaceBenchmarks = unstable_cache(
  async () => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("race_benchmarks")
      .select("division, gender, scope, percentiles");
    return data ?? [];
  },
  ["race-benchmarks-all"],
  { revalidate: 3600, tags: ["race_benchmarks"] },
);
