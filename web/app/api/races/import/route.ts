import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  htmlToText,
  isAllowedImportUrl,
  parsedFieldCount,
  parseRaceText,
} from "@/lib/race-import";

/**
 * 본인 결과 페이지 URL을 서버에서 1회 가져와 파싱한다.
 * - 로그인 필수 (개방 프록시 방지)
 * - 허용된 결과 사이트만 (SSRF 방지 겸 목적 제한)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let url: string;
  try {
    ({ url } = await request.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (typeof url !== "string" || !isAllowedImportUrl(url)) {
    return NextResponse.json(
      {
        error:
          "지원하지 않는 주소입니다. 공식 결과 사이트(results.hyrox.com 등)의 본인 결과 페이지 주소를 입력하거나, 페이지 내용을 복사해 '텍스트 붙여넣기'를 이용하세요.",
      },
      { status: 400 },
    );
  }

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Roxlogy/1.0 (self-result import)" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `결과 페이지를 열 수 없습니다 (HTTP ${res.status}).` },
        { status: 502 },
      );
    }
    html = await res.text();
  } catch {
    return NextResponse.json(
      { error: "결과 페이지를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }

  const parsed = parseRaceText(htmlToText(html));
  if (parsedFieldCount(parsed) === 0) {
    return NextResponse.json(
      {
        error:
          "페이지에서 기록을 인식하지 못했습니다. 결과 화면의 텍스트를 전체 복사해 '텍스트 붙여넣기'로 시도해 주세요.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ parsed });
}
