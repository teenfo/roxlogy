import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile-form";

export const metadata: Metadata = { title: "프로필 설정 — Roxlogy" };

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  return (
    <ProfileForm
      initial={{
        display_name: profile?.display_name ?? "",
        division: profile?.division ?? "",
        gender: profile?.gender ?? "",
        height_cm: profile?.height_cm?.toString() ?? "",
        weight_kg: profile?.weight_kg?.toString() ?? "",
      }}
      email={user!.email ?? ""}
    />
  );
}
