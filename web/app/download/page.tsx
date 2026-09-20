import Link from "next/link";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/rox/shell";
import { getAppDownloads, storageFileExists, AMAZFIT_ZAB_URL, GARMIN_PRG_URL, PLAY_STORE_URL } from "@/lib/app-links";
import { Button } from "@/components/ui/button";
import { Chip, Hint, PageHead, Panel } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.download") };
}

/**
 * 앱 다운로드 — 시안 account.tsx Download() 그대로 (PORT_PLAN §3-f): PageHead · Panel "앱 다운로드"[ p · Button rx-primary ].
 * 우리는 플랫폼이 셋(안드로이드·가민·어메이즈핏)이라 Panel 을 셋으로 늘리고, 상태는 Chip 으로(§4).
 * (app) 밖 공개 라우트 — Shell 이 세션으로 앱 셸/공개 헤더를 가른다.
 */
export default async function DownloadPage() {
  const { t } = await getT();
  const [dl, hasGarmin, hasAmazfit] = await Promise.all([getAppDownloads(), storageFileExists(GARMIN_PRG_URL), storageFileExists(AMAZFIT_ZAB_URL)]);
  const hasApk = !!(dl.wearUrl || dl.phoneUrl);
  const androidReady = !!PLAY_STORE_URL || hasApk;
  const status = (ready: boolean) => <Chip tone={ready ? "green" : "neutral"}>{ready ? t("download.beta") : t("download.comingSoon")}</Chip>;

  return (
    <Shell loginNext="/download">
      <PageHead title={t("download.hero")} description={t("download.heroDesc")} />
      <Panel title={t("download.androidTitle")} action={status(androidReady)}>
        <p>{t("download.androidDesc")}</p>
        {PLAY_STORE_URL ? (
          <Button asChild className="rx-primary">
            <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
              {t("download.playStore")} ↗
            </a>
          </Button>
        ) : hasApk ? (
          <>
            <div className="rx-actions">
              {dl.wearUrl && (
                <Button asChild className="rx-primary">
                  <a href={dl.wearUrl} download>
                    {t("download.wearApk")}
                  </a>
                </Button>
              )}
              {dl.phoneUrl && (
                <Button asChild variant="outline">
                  <a href={dl.phoneUrl} download>
                    {t("download.phoneApk")}
                  </a>
                </Button>
              )}
              {dl.version && (
                <Chip>
                  v{dl.version}
                  {dl.build != null && ` · build ${dl.build}`}
                </Chip>
              )}
            </div>
            <Hint>{t("download.sideloadNote")}</Hint>
          </>
        ) : (
          <Hint>{t("download.androidPending")}</Hint>
        )}
      </Panel>

      <Panel title={t("download.garminTitle")} action={status(hasGarmin)}>
        <p>{t("download.garminDesc")}</p>
        {hasGarmin ? (
          <>
            <Button asChild className="rx-primary">
              <a href={GARMIN_PRG_URL} download>
                {t("download.garminPrg")}
              </a>
            </Button>
            <Hint>{t("download.garminNote")}</Hint>
          </>
        ) : (
          <Hint>{t("download.garminPending")}</Hint>
        )}
      </Panel>

      <Panel title={t("download.amazfitTitle")} action={status(hasAmazfit)}>
        <p>{t("download.amazfitDesc")}</p>
        {hasAmazfit ? (
          <>
            <Button asChild className="rx-primary">
              <a href={AMAZFIT_ZAB_URL} download>
                {t("download.amazfitZab")}
              </a>
            </Button>
            <Hint>{t("download.amazfitNote")}</Hint>
          </>
        ) : (
          <Hint>{t("download.amazfitPending")}</Hint>
        )}
      </Panel>

      {/* iOS는 직접 설치 불가 — App Store 등록 후에만 노출 예정이라 여기서는 생략 */}
      <Hint>
        {t("download.webCta")} <Link href="/signup">{t("common.signup")}</Link>
      </Hint>
    </Shell>
  );
}
