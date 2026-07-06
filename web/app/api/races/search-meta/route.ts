import { NextResponse } from "next/server";
import {
  BROWSER_UA,
  fetchEventGroups,
  parseAthleteList,
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
    const qp = new URLSearchParams({ pid: "list", pidp: "ranking_nav" });
    const dbgName = searchParams.get("name");
    if (dbgName) qp.set("search[name]", dbgName);
    const dbgEvent = searchParams.get("event");
    if (dbgEvent) qp.set("event", dbgEvent);
    if (searchParams.get("sex")) qp.set("search[sex]", searchParams.get("sex")!);
    // 원시 파라미터 추가 프로브 (예: extra=format%3Dfrag)
    for (const kv of (searchParams.get("extra") ?? "").split("&")) {
      const [k, v] = kv.split("=");
      if (k && v != null) qp.set(k, decodeURIComponent(v));
    }
    const url = `https://results.hyrox.com/${season}/?${qp}`;
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
    // 주의: pidp=... 가 "idp="를 포함하므로 [?&] 경계로만 센다
    const idpLinks = [...html.matchAll(/[?&](?:amp;)?idp=/g)].length;
    const structure = {
      listGroupItems: (html.match(/list-group-item/g) ?? []).length,
      fullnameFields: (html.match(/type-fullname/g) ?? []).length,
      tables: (html.match(/<table/g) ?? []).length,
      rowsDiv: (html.match(/class="[^"]*\brow\b[^"]*"/g) ?? []).length,
    };
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
        hitsParsed: parseAthleteList(html, season).slice(0, 5),
        structure,
        // 첫 진짜 선수 링크 주변 원본 — 행 마크업 구조 확인용
        idpContext: (() => {
          const m = html.match(/[?&](?:amp;)?idp=/);
          if (!m || m.index == null) return null;
          const i = m.index;
          return html.slice(Math.max(0, i - 900), i + 400).replace(/\s+/g, " ");
        })(),
        sample: html.slice(0, 600).replace(/\s+/g, " "),
      },
    });
  }

  const groups = await fetchEventGroups(season as Season);
  return NextResponse.json({ groups });
}
