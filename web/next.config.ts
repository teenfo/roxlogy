import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 스파이크: 정적 셸 + 개인 데이터 스트리밍이 이 구조에서 되는지 재 본다
  cacheComponents: true,
};

export default nextConfig;
