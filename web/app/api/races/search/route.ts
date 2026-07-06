import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { searchAthletes } from "@/lib/hyrox-results";

/** 공식 결과 사이트에서 본인 이름 검색 — 로그인 필수, 1회성 조회 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { t } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: t("common.needLogin") }, { status: 401 });

  let name: unknown;
  try {
    ({ name } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof name !== "string" || name.trim().length < 2)
    return NextResponse.json({ hits: [] });

  const hits = await searchAthletes(name);
  return NextResponse.json({ hits });
}
