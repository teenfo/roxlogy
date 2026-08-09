import { createClient } from "@/lib/supabase/server";
import type {
  CrewDirectoryRow,
  CrewMemberRow,
  CrewOverview,
  CrewPost,
  CrewRankRow,
} from "@/lib/crew-types";

export * from "@/lib/crew-types";

/** 크루 개요 — 비공개 크루이거나 없는 slug 면 null */
export async function getCrew(slug: string): Promise<CrewOverview | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_overview", { p_slug: slug });
  return (data as CrewOverview[] | null)?.[0] ?? null;
}

export async function getCrewBoard(
  slug: string,
  category?: string | null,
  limit = 20,
  offset = 0,
): Promise<CrewPost[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_board", {
    p_slug: slug,
    p_category: category ?? null,
    p_limit: limit,
    p_offset: offset,
  });
  return (data ?? []) as CrewPost[];
}

export async function getCrewDirectory(limit = 50): Promise<CrewDirectoryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_directory", { p_limit: limit });
  return (data ?? []) as CrewDirectoryRow[];
}

export async function getCrewLeaderboard(
  slug: string,
  division?: string | null,
  limit = 50,
): Promise<CrewRankRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_leaderboard", {
    p_slug: slug,
    p_division: division ?? null,
    p_limit: limit,
  });
  return (data ?? []) as CrewRankRow[];
}

export async function getCrewRoster(slug: string): Promise<CrewMemberRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_roster", { p_slug: slug });
  return (data ?? []) as CrewMemberRow[];
}
