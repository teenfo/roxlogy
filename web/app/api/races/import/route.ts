import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  isAllowedImportUrl,
  parsedFieldCount,
  parseRaceHtml,
} from "@/lib/race-import";
import { BROWSER_UA } from "@/lib/hyrox-results";

/**
 * 본인 결과 페이지 URL을 서버에서 1회 가져와 파싱한다.
 * - 로그인 필수 (개방 프록시 방지)
 * - 허용된 결과 사이트만 (SSRF 방지 겸 목적 제한)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { t } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: t("common.needLogin") }, { status: 401 });

  let url: string;
  try {
    ({ url } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (typeof url !== "string" || !isAllowedImportUrl(url)) {
    return NextResponse.json(
      { error: t("raceNew.import.failFetch") },
      { status: 400 },
    );
  }

  let html: string;
  try {
    const res = await fetch(url, {
      // 결과 사이트가 비브라우저 UA를 차단하는 경우가 있어 브라우저 UA 사용
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `${t("raceNew.import.failFetch")} (HTTP ${res.status})` },
        { status: 502 },
      );
    }
    html = await res.text();
  } catch {
    return NextResponse.json(
      { error: t("raceNew.import.failFetch") },
      { status: 502 },
    );
  }

  const parsed = parseRaceHtml(html);
  if (parsedFieldCount(parsed) === 0) {
    return NextResponse.json(
      { error: t("raceNew.import.failParse") },
      { status: 422 },
    );
  }

  return NextResponse.json({ parsed });
}
