import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { searchAthletes, SEASONS, type Season } from "@/lib/hyrox-results";

/** 공식 결과 사이트에서 본인 결과 검색 — 로그인 필수, 1회성 조회 */
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
  if (lastName.length < 2) return NextResponse.json({ hits: [] });

  const { hits, blocked } = await searchAthletes({
    season,
    eventGroup: body.eventGroup?.trim() || undefined,
    sex: body.sex === "M" || body.sex === "W" ? body.sex : undefined,
    lastName,
    firstName: body.firstName?.trim() || undefined,
  });
  return NextResponse.json({ hits, blocked });
}
