import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";

/**
 * 사용자와 무관한 공개 참조 데이터 캐시.
 *
 * race_events·race_benchmarks 는 RLS 가 `select true` 인 공개 테이블이라 누가
 * 조회하든 같은 행이 나온다. 요청마다 DB 를 때릴 이유가 없어 1시간 캐시한다.
 *
 * 캐시 안에서는 `cookies()` 를 쓸 수 없으므로(Next 가 동적 소스 접근을 막는다)
 * 세션 없는 anon 클라이언트를 따로 만든다 — 공개 정책으로만 읽으므로 안전하다.
 * 사용자별 데이터는 여기에 절대 넣지 말 것: 캐시는 전역이라 한 사용자의 행이
 * 다른 사용자에게 그대로 나간다.
 */
function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** 공개 대회 일정. */
export const getRaceEvents = unstable_cache(
  async () => {
    const { data } = await anonClient()
      .from("race_events")
      .select("*")
      .order("start_date", { ascending: true, nullsFirst: false });
    return data ?? [];
  },
  ["race-events-all"],
  { revalidate: 3600, tags: ["race_events"] },
);

/** 백분위 분포 (배치로만 갱신). */
export const getRaceBenchmarks = unstable_cache(
  async () => {
    const { data } = await anonClient()
      .from("race_benchmarks")
      .select("division, gender, scope, percentiles");
    return data ?? [];
  },
  ["race-benchmarks-all"],
  { revalidate: 3600, tags: ["race_benchmarks"] },
);
