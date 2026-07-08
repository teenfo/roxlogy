import { NextResponse } from "next/server";
import {
  fetchAvailableSeasons,
  fetchDivisions,
  fetchEventGroups,
  SEASONS,
  type Season,
} from "@/lib/hyrox-results";

/**
 * 검색 폼용 메타 (공개 사실 정보만 다루므로 인증 불요, 결과 캐시됨):
 *   ?seasons=1                → 실존 시즌 목록
 *   ?season=&divisionsFor=    → 대회의 디비전 목록
 *   ?season=                  → 시즌의 대회(event_main_group) 목록
 */
// 시즌 프로브(9개 병렬) 등 외부 조회가 여러 번 — 기본 상한 방지
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("seasons") === "1") {
    const seasons = await fetchAvailableSeasons();
    return NextResponse.json({ seasons });
  }

  const season = searchParams.get("season") ?? SEASONS[0];
  if (!(SEASONS as readonly string[]).includes(season))
    return NextResponse.json({ groups: [] });

  const divisionsFor = searchParams.get("divisionsFor");
  if (divisionsFor) {
    const divisions = await fetchDivisions(season as Season, divisionsFor);
    return NextResponse.json({ divisions });
  }

  const groups = await fetchEventGroups(season as Season);
  return NextResponse.json({ groups });
}
