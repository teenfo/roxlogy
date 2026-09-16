import type { NextConfig } from "next";

/**
 * cacheComponents(구 experimental.ppr) — 정적 셸을 엣지에서 즉시 내보내고 개인 데이터만
 * 스트리밍한다. 모든 라우트가 동적이라 응답 전까지 화면이 비어 있던 문제를 줄인다
 * (2026-09-13, docs/PERF.md §4·§9). 전역 플래그라 라우트별 옵트인이 없다.
 */
/**
 * 디자인 캡쳐용 픽스처 모드 (`ROX_FIXTURES=1`). 샌드박스에서는 supabase.co 로
 * 나갈 수 없어서 전 화면을 같은 조건으로 찍으려면 데이터를 대신 넣어야 한다.
 * `@supabase/ssr` 을 통째로 갈아끼우면 server·client·proxy 가 한 번에 덮인다 —
 * 애플리케이션 코드는 한 줄도 건드리지 않는다.
 *
 * 환경변수가 없으면 alias 자체가 붙지 않으므로 **운영 빌드에는 영향이 없다.**
 */
const FIXTURES = process.env.ROX_FIXTURES === "1";
const FIXTURE_ALIAS = { "@supabase/ssr": "./lib/supabase/__fixtures__/ssr.ts" };

const nextConfig: NextConfig = {
  cacheComponents: true,
  ...(FIXTURES ? { turbopack: { resolveAlias: FIXTURE_ALIAS } } : {}),
  // 글꼴 조각은 내용이 고정이다(pretendard 1.3.9 를 그대로 옮긴 파일). 기본값이면
  // 방문할 때마다 재검증 요청이 붙는데, 92개 조각에 그걸 물리면 낭비다.
  async headers() {
    return [
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
