import Image from "next/image";
import Link from "next/link";
import { getT } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";
import {
  ANDROID_PHONE_APK_URL,
  ANDROID_WEAR_APK_URL,
  PLAY_STORE_URL,
} from "@/lib/app-links";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.download") };
}

export default async function DownloadPage() {
  const { t } = await getT();
  const hasApk = !!(ANDROID_WEAR_APK_URL || ANDROID_PHONE_APK_URL);
  const androidReady = !!PLAY_STORE_URL || hasApk;

  const apkBtn =
    "rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110";

  return (
    <main className="flex flex-1 flex-col">
      <div className="flex items-center justify-between px-6 pt-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/roxlogy-mark.svg" alt="Roxlogy" width={28} height={28} />
          <span className="text-sm font-black tracking-widest">ROXLOGY</span>
        </Link>
        <LocaleSwitcher compact />
      </div>

      <section className="mx-auto w-full max-w-lg px-6 pb-24 pt-12">
        <h1 className="text-3xl font-black tracking-wide">{t("download.title")}</h1>
        <p className="mt-3 text-muted">{t("download.desc")}</p>

        {/* 안드로이드 */}
        <div className="mt-8 rounded-md bg-surface px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t("download.androidTitle")}</h2>
              <p className="mt-1 text-sm text-muted">
                {t("download.androidDesc")}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-background px-3 py-1 text-xs text-muted">
              {androidReady ? t("download.beta") : t("download.comingSoon")}
            </span>
          </div>

          {PLAY_STORE_URL ? (
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-4 inline-block ${apkBtn}`}
            >
              {t("download.playStore")}
            </a>
          ) : hasApk ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {ANDROID_WEAR_APK_URL && (
                  <a href={ANDROID_WEAR_APK_URL} download className={apkBtn}>
                    {t("download.wearApk")}
                  </a>
                )}
                {ANDROID_PHONE_APK_URL && (
                  <a
                    href={ANDROID_PHONE_APK_URL}
                    download
                    className="rounded-md border border-accent px-5 py-2.5 text-sm font-semibold text-accent hover:bg-accent/10"
                  >
                    {t("download.phoneApk")}
                  </a>
                )}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                {t("download.sideloadNote")}
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">{t("download.androidPending")}</p>
          )}
        </div>

        {/* iOS는 직접 설치 불가 — App Store 등록 후에만 노출 예정이라 여기서는 생략 */}

        <p className="mt-8 text-center text-sm text-muted">
          {t("download.webCta")}{" "}
          <Link href="/signup" className="text-accent hover:underline">
            {t("common.signup")}
          </Link>
        </p>
      </section>
    </main>
  );
}
