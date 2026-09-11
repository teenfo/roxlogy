import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { ProfileForm } from "@/components/profile-form";
import { NotificationSettings } from "@/components/notification-settings";
import { HyroxLinkForm } from "@/components/hyrox-link-form";
import { McpConnect } from "@/components/mcp-connect";
import { LinkedAccounts } from "@/components/linked-accounts";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SettingsChips, SettingsNav } from "@/components/settings-nav";
import { SettingsCard } from "@/components/ui/settings-ui";
import { SignOutForm } from "@/components/sign-out-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.profile") };
}

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  const { t, tag, tz } = await getT();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  const displayName = profile?.display_name ?? "Athlete";
  const email = user!.email ?? "";
  // 날짜·연도는 서버(KST) 기준으로 계산해 넘긴다 — 클라이언트 렌더에서
  // new Date() 를 쓰면 순수하지 않은 렌더가 된다.
  const now = new Date();
  const lastSaved = profile?.updated_at
    ? new Date(profile.updated_at).toLocaleDateString(tag, {
        month: "long",
        day: "numeric",
        timeZone: tz,
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-[960px]">
      {/* 모바일: 상단 고정 섹션 칩 (데스크톱은 좌측 목차) */}
      <SettingsChips />

      <div className="grid items-start gap-8 pt-1 md:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav name={displayName} email={email} />

        <div className="flex min-w-0 flex-col gap-5">
          <header>
            <h1 className="text-3xl font-extrabold tracking-tight max-md:text-2xl">
              {t("profile.title")}
            </h1>
            <p className="mt-1 text-[15px] text-muted">
              {t("profile.subtitle")}
            </p>
          </header>

          {/* 언어 — 데스크톱은 좌측 목차 하단, 모바일은 본문 최상단 */}
          <div className="flex items-center gap-4 rounded-xl border border-line bg-card px-4 py-3.5 md:hidden">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("profile.language")}</p>
              <p className="mt-0.5 text-xs text-muted">
                {t("profile.languageDesc")}
              </p>
            </div>
            <LocaleSwitcher />
          </div>

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

          {/* 계정 — 로그인 수단 + 앱 다운로드 */}
          <SettingsCard
            id="account"
            title={t("profile.secAccount")}
            desc={t("profile.secAccountDesc")}
            bodyClassName="flex flex-col"
          >
            <LinkedAccounts email={email} />
            <Link
              href="/download"
              className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-soft px-[22px] py-3.5 transition-colors hover:bg-card-hover max-md:px-4"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-line text-muted"
              >
                ↓
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {t("profile.getApp")}
                </span>
                <span className="block truncate text-[13px] text-muted">
                  {t("profile.getAppDesc")}
                </span>
              </span>
              <span aria-hidden className="shrink-0 text-accent">
                →
              </span>
            </Link>
          </SettingsCard>

          {/* 연동 — 카드 두 장을 한 섹션으로 묶는다 */}
          <section id="integrations" className="scroll-mt-[110px]">
            <h2 className="text-base font-extrabold">
              {t("profile.secIntegrations")}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {t("profile.secIntegrationsDesc")}
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <div className="overflow-hidden rounded-[14px] border border-line bg-card">
                <HyroxLinkForm
                  linkedName={profile?.hyrox_athlete_name ?? null}
                />
              </div>
              <div className="overflow-hidden rounded-[14px] border border-line bg-card">
                <McpConnect
                  token={profile?.mcp_token ?? ""}
                  writeEnabled={Boolean(profile?.mcp_write)}
                />
              </div>
            </div>
          </section>

          <NotificationSettings />

          <div className="pb-4 text-[13px] text-muted">
            <SignOutForm
              buttonClassName="hover:text-foreground"
              label={t("common.logout")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
