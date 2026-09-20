import { createClient } from "@supabase/supabase-js";
import { cache } from "react";

export type PublicCrew = {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  location: string | null;
  member_count: number;
};

export type PublicEvent = {
  title: string;
  description: string | null;
  starts_at: string;
  location: string | null;
  capacity: number | null;
  goingCount: number;
  crew: PublicCrew;
};

/** Share metadata always uses the anonymous identity, even for a logged-in owner.
 * Do not replace this with the cookie-aware server client or a service-role client.
 * No persistent data cache: a change to visibility must affect the next request. */
function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      }),
    },
  });
}

// React.cache only deduplicates within one render; it does not cache private data
// between requests. These RPCs already enforce public/active crew visibility.
export const getPublicCrew = cache(async (slug: string): Promise<PublicCrew | null> => {
  try {
    const client = publicClient();
    if (!client) return null;
    const { data, error } = await client.rpc("crew_overview", { p_slug: slug })
      .select("slug,name,tagline,description,location,member_count,crew_status");
    if (error) return null;
    const crew = Array.isArray(data) ? data[0] : null;
    if (!crew || crew.slug !== slug || crew.crew_status !== "active") return null;
    return {
      slug: crew.slug, name: crew.name, tagline: crew.tagline,
      description: crew.description, location: crew.location,
      member_count: crew.member_count,
    };
  } catch {
    return null; // Network/configuration errors get the same neutral brand fallback.
  }
});

export const getPublicEvent = cache(async (slug: string, eventId: string): Promise<PublicEvent | null> => {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId)) return null;
  try {
    const client = publicClient();
    if (!client) return null;
    const [crew, result] = await Promise.all([
      getPublicCrew(slug),
      client.rpc("crew_event_detail", { p_event: eventId })
        .select("id,slug,title,description,starts_at,location,capacity,going,members_only"),
    ]);
    if (result.error || !crew) return null;
    const event = Array.isArray(result.data) ? result.data[0] : null;
    // Fail closed, including a UUID pasted under a different crew's URL.
    if (!event || event.slug !== slug || event.id !== eventId || event.members_only !== false) return null;
    if (!Number.isFinite(Date.parse(event.starts_at))) return null;
    return {
      title: event.title, description: event.description,
      starts_at: event.starts_at, location: event.location,
      capacity: event.capacity, goingCount: Array.isArray(event.going) ? event.going.length : 0,
      crew,
    }; // Attendee names, comments and membership details never enter a share card.
  } catch {
    return null;
  }
});
