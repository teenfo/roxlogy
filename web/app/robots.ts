import type { MetadataRoute } from "next";

const BASE = "https://roxlogy.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/predict", "/events", "/login", "/signup"],
      disallow: ["/dashboard", "/sessions", "/races", "/settings", "/auth", "/exercises"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
