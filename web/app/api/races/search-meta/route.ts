import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchEventGroups, SEASONS, type Season } from "@/lib/hyrox-results";

/** 검색 폼용 메타: 시즌의 대회(event_main_group) 목록 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season") ?? SEASONS[0];
  if (!(SEASONS as readonly string[]).includes(season))
    return NextResponse.json({ groups: [] });

  const groups = await fetchEventGroups(season as Season);
  return NextResponse.json({ groups });
}
