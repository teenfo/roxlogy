import type { NextConfig } from "next";

/**
 * cacheComponents(구 experimental.ppr) — 정적 셸을 엣지에서 즉시 내보내고 개인 데이터만
 * 스트리밍한다. 모든 라우트가 동적이라 응답 전까지 화면이 비어 있던 문제를 줄인다
 * (2026-09-13, docs/PERF.md §4·§9). 전역 플래그라 라우트별 옵트인이 없다.
 */
const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
