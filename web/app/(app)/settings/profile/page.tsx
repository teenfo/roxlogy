import { Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getAdmin } from "@/lib/admin";
import { getT } from "@/lib/i18n";
import { ProfileForm } from "@/components/profile-form";
import { NotificationSettings } from "@/components/notification-settings";
import { HyroxLinkForm } from "@/components/hyrox-link-form";
import { McpConnect } from "@/components/mcp-connect";
import { LinkedAccounts } from "@/components/linked-accounts";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SignOutForm } from "@/components/sign-out-form";
import { SidebarCrewSelect } from "@/components/sidebar-crew-select";
import { SettingsTabs } from "@/components/settings-tabs";
import { getShellData } from "@/lib/shell";
import { Field, Go, Hint, PageHead, Panel, RecordRow } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.profile") };
}

/**
 * 내 프로필과 설정 — 시안 account.tsx Settings() 그대로 (PORT_PLAN §3-f):
 * PageHead(+ Go 관리자) · Segments(프로필 · 계정 · 연동 · 알림) ·
 * [프로필] Panel 공개 프로필(.rx-profile-editor · rx-form-grid · .rx-switch-row 리더보드 · 버튼)
 * [계정] Panel 로그인과 기기(RowLink 앱 다운로드 · Hint · 버튼)
 * [연동] Panel HYROX 공식 기록(.rx-switch-row + Chip) · Panel 내 AI 연결(.rx-info-grid)
 * [알림] Panel 받고 싶은 알림(.rx-switch-row × N · Hint).
 * 로그인 수단·사이드바 크루·언어·MCP 토큰은 우리 것이라 같은 Panel 안에 Field·행으로(§4).
 */
export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  const [{ t, tag, tz }, shell, { isAdmin }] = await Promise.all([getT(), getShellData(), getAdmin()]);
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single();

  const displayName = profile?.display_name ?? "Athlete";
  const email = user!.email ?? "";
  // 날짜·연도는 서버(KST) 기준으로 계산해 넘긴다 — 클라이언트 렌더에서
  // new Date() 를 쓰면 순수하지 않은 렌더가 된다.
  const now = new Date();
  const lastSaved = profile?.updated_at ? new Date(profile.updated_at).toLocaleDateString(tag, { month: "long", day: "numeric", timeZone: tz }) : null;

  const panels = {
    profile: (
      <>
        <ProfileForm
          initial={{
            display_name: profile?.display_name ?? "",
            gender: profile?.gender ?? "",
            height_cm: profile?.height_cm?.toString() ?? "",
            weight_kg: profile?.weight_kg?.toString() ?? "",
            birth_year: profile?.birth_year?.toString() ?? "",
            instagram: profile?.instagram ?? "",
            leaderboard_opt_in: profile?.leaderboard_opt_in ?? false,
          }}
          currentYear={now.getFullYear()}
          lastSaved={lastSaved}
        />
        {/* 사이드바에 고정할 크루 — 크루가 둘 이상일 때만 (PORT_PLAN §7-5) */}
        {shell.crews.length >= 2 && (
          <Panel title={t("settings.sidebarTitle")}>
            <SidebarCrewSelect userId={user!.id} crews={shell.crews} current={shell.pinned} />
          </Panel>
        )}
      </>
    ),
    account: (
      <Panel title={t("settings.loginDevices")}>
        <LinkedAccounts email={email} />
        <RecordRow href="/download" title={t("profile.getApp")} note={t("profile.getAppDesc")} />
        <Field label={t("profile.language")}>
          <LocaleSwitcher className="rx-locale" />
        </Field>
        <Hint>{t("profile.languageDesc")}</Hint>
        <SignOutForm buttonClassName="rx-pft-close" label={t("common.logout")} />
      </Panel>
    ),
    integrations: (
      <>
        <HyroxLinkForm linkedName={profile?.hyrox_athlete_name ?? null} />
        <McpConnect token={profile?.mcp_token ?? ""} writeEnabled={Boolean(profile?.mcp_write)} />
      </>
    ),
    notifications: <NotificationSettings />,
  };

  return (
    <>
      <PageHead
        title={t("settings.hero")}
        description={`${displayName} · ${email}`}
        action={
          isAdmin ? (
            <Go href="/admin">
              <Shield size={16} />
              {t("nav.admin")}
            </Go>
          ) : undefined
        }
      />
      <SettingsTabs
        label={t("settings.hero")}
        tabs={[
          ["profile", t("profile.secProfile")],
          ["account", t("profile.secAccount")],
          ["integrations", t("profile.secIntegrations")],
          ["notifications", t("notif.title")],
        ]}
        panels={panels}
      />
    </>
  );
}
