import type { MetadataRoute } from "next";

const BASE = "https://roxlogy.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/crews", "/predict", "/events", "/login", "/signup"],
      // 크루 하위의 회계·관리는 로그인·권한이 필요해 크롤러에게 의미가 없다
      disallow: [
        "/dashboard",
        "/sessions",
        "/races",
        "/settings",
        "/auth",
        "/exercises",
        "/crews/new",
        "/crews/*/finance",
        "/crews/*/manage",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
