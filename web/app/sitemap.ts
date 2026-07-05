import type { MetadataRoute } from "next";

const BASE = "https://roxlogy.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/predict`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/events`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/signup`, changeFrequency: "yearly", priority: 0.5 },
  ];
}
