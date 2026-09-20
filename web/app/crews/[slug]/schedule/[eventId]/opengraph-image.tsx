import { connection } from "next/server";
import { getPublicEvent } from "@/lib/og/public-data";
import { brandFallback, eventDate, renderCard } from "@/lib/og/card";

export const alt = "Roxlogy crew meetup";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
  await connection();
  const { slug, eventId } = await params;
  const event = await getPublicEvent(slug, eventId);
  if (!event) return brandFallback();
  return renderCard({
    kind: "event", title: event.title, subtitle: event.crew.name,
    details: eventDate(event.starts_at),
    count: event.capacity ? `${event.goingCount} / ${event.capacity}` : String(event.goingCount),
    countLabel: "GOING",
  });
}
