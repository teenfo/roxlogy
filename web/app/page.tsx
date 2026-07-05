import Image from "next/image";
import Link from "next/link";
import { getT } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";

export default async function Landing() {
  const { t } = await getT();
  const features = [1, 2, 3] as const;

  return (
    <main className="flex flex-1 flex-col">
      <div className="flex justify-end px-6 pt-4">
        <LocaleSwitcher compact />
      </div>
      <section className="flex flex-col items-center gap-8 px-6 pb-16 pt-16">
        <Image
          src="/roxlogy-mark.svg"
          alt="Roxlogy"
          width={120}
          height={120}
          priority
        />
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-widest">ROXLOGY</h1>
          <p className="mt-3 text-muted">{t("landing.tagline")}</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/login"
            className="rounded-md border border-muted/40 px-6 py-2.5 text-sm font-semibold hover:border-foreground"
          >
            {t("common.login")}
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-accent px-6 py-2.5 text-sm font-bold text-background hover:brightness-110"
          >
            {t("common.signup")}
          </Link>
        </div>
        <div className="flex gap-6 text-sm">
          <Link href="/predict" className="text-track hover:underline">
            {t("landing.predictLink")}
          </Link>
          <Link href="/events" className="text-track hover:underline">
            {t("landing.eventsLink")}
          </Link>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-4xl gap-4 px-6 pb-24 sm:grid-cols-3">
        {features.map((n) => (
          <div key={n} className="rounded-md bg-surface px-5 py-5">
            <h2 className="font-semibold">{t(`landing.feature${n}.title`)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {t(`landing.feature${n}.body`)}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
