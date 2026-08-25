import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCityLatestStats,
  getEventLiveDetail,
} from "@/lib/hyrox-event-detail";

/**
 * 대회 실측 통계 — 레이스 계산기의 "목표 대회" 참고용.
 * 대회가 이미 열렸으면 그 회차 통계, 미래 대회면 같은 도시의 최근 회차 통계.
 * 내부적으로 unstable_cache(1~6시간)라 레이트리밋에 안전하다.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: ev } = await supabase
    .from("race_events")
    .select("id, name, city, api_city, season, start_date, end_date")
    .eq("id", id)
    .maybeSingle();
  if (!ev) return NextResponse.json({ stats: null }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const isPast = !!ev.start_date && ev.start_date <= today;

  if (isPast) {
    const live = await getEventLiveDetail(ev);
    if (live?.divisions.length) {
      return NextResponse.json({
        stats: { source: "this", label: ev.name, divisions: live.divisions },
      });
    }
  }
  const prev = await getCityLatestStats(
    [ev.api_city, ev.city].filter((c): c is string => !!c),
  );
  return NextResponse.json({
    stats: prev
      ? { source: "previous", label: prev.label, divisions: prev.divisions }
      : null,
  });
}
