import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { ProfileForm } from "@/components/profile-form";
import { NotificationSettings } from "@/components/notification-settings";
import { HyroxLinkForm } from "@/components/hyrox-link-form";
import { McpConnect } from "@/components/mcp-connect";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.profile") };
}

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  const { t } = await getT();
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
          birth_year: profile?.birth_year?.toString() ?? "",
          leaderboard_opt_in: profile?.leaderboard_opt_in ?? false,
        }}
        email={user!.email ?? ""}
      />
      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t("hyroxLink.title")}</h2>
        <div className="mt-3 rounded-md bg-surface p-4">
          <HyroxLinkForm linkedName={profile?.hyrox_athlete_name ?? null} />
        </div>
      </section>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t("mcp.title")}</h2>
        <div className="mt-3 rounded-md bg-surface p-4">
          <McpConnect token={profile?.mcp_token ?? ""} />
        </div>
      </section>
      <NotificationSettings />
    </>
  );
}
