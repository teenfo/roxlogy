import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  searchAthletes,
  SEASONS,
  type SearchFilters,
  type Season,
} from "@/lib/hyrox-results";

/**
 * 공식 결과 사이트에서 본인 결과 검색 — 로그인 필수, 1회성 조회.
 * 공식 검색의 이름 매칭이 엄격하므로(성 필드 기준, 이름은 별도 필드)
 * 0건이면 조건을 단계적으로 완화해 재시도한다:
 *   ① 입력 그대로 → ② 성별 제외 → ③ 이름(first) 제외 → ④ 성·이름 스왑
 */
// 완화 단계 × 디비전 병합 × 페이지 추적으로 외부 조회가 많다 — 기본 상한(15s) 방지
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { t } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: t("common.needLogin") }, { status: 401 });

  let body: {
    season?: string;
    eventGroup?: string;
    division?: string;
    sex?: string;
    lastName?: string;
    firstName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const season: Season = (SEASONS as readonly string[]).includes(
    body.season ?? "",
  )
    ? (body.season as Season)
    : SEASONS[0];
  const lastName = (body.lastName ?? "").trim();
  const firstName = (body.firstName ?? "").trim();
  const eventGroup = body.eventGroup?.trim() || undefined;
  const division = body.division?.trim() || undefined;
  const sex = body.sex === "M" || body.sex === "W" ? body.sex : undefined;
  if (lastName.length < 2) return NextResponse.json({ hits: [] });

  const attempts: SearchFilters[] = [
    { season, eventGroup, division, sex, lastName, firstName: firstName || undefined },
  ];
  if (sex)
    attempts.push({
      season,
      eventGroup,
      division,
      lastName,
      firstName: firstName || undefined,
    });
  if (firstName) {
    attempts.push({ season, eventGroup, division, lastName });
    if (firstName.length >= 2)
      attempts.push({ season, eventGroup, division, lastName: firstName, firstName: lastName });
  }
  // 성 칸에 풀네임을 넣은 경우: 마지막 토큰만으로 재시도
  const tokens = lastName.split(/\s+/);
  if (tokens.length >= 2) {
    attempts.push({ season, eventGroup, division, lastName: tokens[tokens.length - 1] });
    attempts.push({ season, eventGroup, division, lastName: tokens[0] });
  }

  for (const filters of attempts) {
    const { hits, firstNameMatched } = await searchAthletes(filters);
    if (hits.length)
      return NextResponse.json({
        hits,
        // 사용자가 이름을 입력했는데 목록이 이름으로 걸러지지 못한 경우
        // (완화 단계에서 이름이 빠졌거나 부분일치 0건 → 전체 목록 표시)
        firstNameMiss: !!firstName && firstNameMatched !== true,
      });
  }
  return NextResponse.json({ hits: [], firstNameMiss: false });
}
