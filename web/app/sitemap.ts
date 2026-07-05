import type { MetadataRoute } from "next";

// 배포 도메인 확정 전 placeholder — Vercel 배포 시 실제 도메인으로 검증
const BASE = "https://roxlogy.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/predict`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/events`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/signup`, changeFrequency: "yearly", priority: 0.5 },
  ];
}
