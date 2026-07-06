import { NextResponse } from "next/server";
import {
  BROWSER_UA,
  fetchEventGroups,
  parseEventGroups,
  SEASONS,
  type Season,
} from "@/lib/hyrox-results";

/**
 * 검색 폼용 메타: 시즌의 대회(event_main_group) 목록.
 * 공개 사실 정보(대회 목록)만 다루므로 인증 불요 — 결과 캐시됨.
 * ?debug=1 이면 원본 페이지의 폼 필드명 진단 정보를 함께 반환.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season") ?? SEASONS[0];
  if (!(SEASONS as readonly string[]).includes(season))
    return NextResponse.json({ groups: [] });

  if (searchParams.get("debug") === "1") {
    const url = `https://results.hyrox.com/${season}/?pid=list&pidp=ranking_nav`;
    let status = 0;
    let html = "";
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en",
        },
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      html = await res.text();
    } catch (e) {
      return NextResponse.json({ debug: { url, error: String(e) } });
    }
    const fieldNames = [
      ...new Set(
        [...html.matchAll(/<(?:select|input)[^>]*name="([^"]+)"/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    const selectIds = [
      ...new Set(
        [...html.matchAll(/<select[^>]*id="([^"]+)"/g)].map((m) => m[1]),
      ),
    ];
    const idpLinks = [...html.matchAll(/idp=/g)].length;
    return NextResponse.json({
      debug: {
        url,
        status,
        htmlLen: html.length,
        title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null,
        fieldNames,
        selectIds,
        idpLinks,
        groupsParsed: parseEventGroups(html).slice(0, 5),
        sample: html.slice(0, 600).replace(/\s+/g, " "),
      },
    });
  }

  const groups = await fetchEventGroups(season as Season);
  return NextResponse.json({ groups });
}
