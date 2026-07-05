import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { RaceNewForm } from "@/components/race-new-form";

export const metadata: Metadata = { title: "레이스 결과 등록 — Roxlogy" };

export default async function RaceNewPage() {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("race_events")
    .select("name")
    .order("name");
  const names = [...new Set((events ?? []).map((e) => e.name))];
  return <RaceNewForm eventNames={names} />;
}
