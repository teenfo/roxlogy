import { createServerClient } from "@supabase/ssr";
import type { MetadataRoute } from "next";

const BASE = "https://roxlogy.com";

// 새로 만든 크루가 재배포 없이도 색인되도록 1시간마다 다시 만든다.
export const revalidate = 3600;

/** 공개 크루 슬러그 — 크루 목록·소개는 로그인 없이 열리므로 색인 대상이다.
 *  cookies() 를 쓰지 않는다: 사이트맵은 요청 컨텍스트 밖에서도 생성된다. */
async function publicCrewSlugs(): Promise<{ slug: string }[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
  const { data, error } = await supabase.rpc("crew_directory", { p_limit: 100 });
  if (error) return [];
  return (data ?? []) as { slug: string }[];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const crews = await publicCrewSlugs();
  return [
    { url: `${BASE}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/crews`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/predict`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/events`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/signup`, changeFrequency: "yearly", priority: 0.5 },
    ...crews.map((c) => ({
      url: `${BASE}/crews/${c.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
