import { connection } from "next/server";
import { getPublicCrew } from "@/lib/og/public-data";
import { brandFallback, renderCard } from "@/lib/og/card";

export const alt = "Roxlogy crew";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const crew = await getPublicCrew(slug);
  if (!crew) return brandFallback();
  return renderCard({
    kind: "crew", title: crew.name,
    subtitle: crew.tagline ?? "ROXLOGY CREW",
    details: crew.location ?? "A community for hybrid racing",
    count: String(crew.member_count), countLabel: "MEMBERS",
  });
}
