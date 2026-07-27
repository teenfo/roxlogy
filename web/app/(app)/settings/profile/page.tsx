import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { ProfileForm } from "@/components/profile-form";
import { NotificationSettings } from "@/components/notification-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.profile") };
}

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  return (
    <>
      <ProfileForm
        initial={{
          display_name: profile?.display_name ?? "",
          gender: profile?.gender ?? "",
          height_cm: profile?.height_cm?.toString() ?? "",
          weight_kg: profile?.weight_kg?.toString() ?? "",
          leaderboard_opt_in: profile?.leaderboard_opt_in ?? false,
        }}
        email={user!.email ?? ""}
      />
      <NotificationSettings />
    </>
  );
}
