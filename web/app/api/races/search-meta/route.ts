import { NextResponse } from "next/server";
import {
  BROWSER_UA,
  fetchEventGroups,
  parseAthleteList,
  parseEventGroups,
  SEASONS,
  type Season,
} from "@/lib/hyrox-results";
import { htmlToText, parseRaceText } from "@/lib/race-import";

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

  // JS 번들에서 실제 데이터 API 주소 탐색 (mikatiming 정적 호스트 한정)
  const jsUrl = searchParams.get("jsurl");
  if (jsUrl) {
    try {
      const u = new URL(jsUrl);
      if (
        !/(^|\.)mikatiming\.(com|net)$/.test(u.hostname) &&
        u.hostname !== "results.hyrox.com"
      )
        return NextResponse.json({ error: "host not allowed" }, { status: 400 });
      const res = await fetch(jsUrl, {
        headers: { "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(10_000),
      });
      const js = await res.text();
      // q=<리터럴> 이면 해당 문자열 주변 컨텍스트를 반환 (호출부 확인용)
      const q = searchParams.get("q");
      if (q) {
        const ctxs: string[] = [];
        let idx = 0;
        while (ctxs.length < 20) {
          const i = js.indexOf(q, idx);
          if (i < 0) break;
          ctxs.push(js.slice(Math.max(0, i - 80), i + q.length + 160));
          idx = i + q.length;
        }
        return NextResponse.json({ jsUrl, q, count: ctxs.length, ctxs });
      }
      const urls = [
        ...new Set(
          [...js.matchAll(/["'\x60]([^"'\x60\s]*(?:json|api|ajax|graphql|list\?|content=)[^"'\x60\s]*)["'\x60]/gi)]
            .map((m) => m[1])
            .filter((s) => s.length > 3 && s.length < 200),
        ),
      ].slice(0, 60);
      return NextResponse.json({
        jsUrl,
        status: res.status,
        len: js.length,
        candidates: urls,
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

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
          ...(searchParams.get("xhr") === "1"
            ? { "X-Requested-With": "XMLHttpRequest" }
            : {}),
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
        raceParsed: (() => {
          const r = parseRaceText(htmlToText(html));
          return {
            event: r.event ?? null,
            eventDate: r.eventDate ?? null,
            division: r.division ?? null,
            totalMs: r.totalMs ?? null,
            runTotalMs: r.runTotalMs ?? null,
            stations: r.stations,
          };
        })(),
        structure,
        scriptSrcs: [
          ...new Set(
            [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
          ),
        ].slice(0, 20),
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
