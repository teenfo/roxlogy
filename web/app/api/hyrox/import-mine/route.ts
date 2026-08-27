import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resultApiEnabled } from "@/lib/hyrox-result-api";
import { importMyRaces } from "@/lib/hyrox-import-user";

// Result API 스로틀(호출 간 2.2s) 때문에 수십 초 걸릴 수 있다
export const maxDuration = 60;

/** 본인 공식 기록 즉시 임포트 — 연동 직후·설정의 "지금 가져오기" 버튼 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!resultApiEnabled())
    return NextResponse.json({ error: "api_disabled" }, { status: 503 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("hyrox_person_ref, hyrox_athlete_name")
    .eq("id", user.id)
    .single();
  if (!profile?.hyrox_person_ref)
    return NextResponse.json({ error: "not_linked" }, { status: 422 });

  try {
    const result = await importMyRaces(
      supabase,
      user.id,
      profile.hyrox_person_ref,
      profile.hyrox_athlete_name,
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error("import-mine failed:", e);
    return NextResponse.json({ error: "import_failed" }, { status: 502 });
  }
}
