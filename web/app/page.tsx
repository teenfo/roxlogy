import Image from "next/image";
import Link from "next/link";
import { getCrewDirectory } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Avatar } from "@/components/ui/crew-ui";

export default async function Landing() {
  // 크루 목록은 공개 RPC(crew_directory)라 비로그인에서도 그대로 내려온다.
  const [{ t }, crews] = await Promise.all([getT(), getCrewDirectory(6)]);
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
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm">
          <Link href="/crews" className="text-accent hover:underline">
            {t("landing.crewsLink")}
          </Link>
          <Link href="/predict" className="text-accent hover:underline">
            {t("landing.predictLink")}
          </Link>
          <Link href="/events" className="text-accent hover:underline">
            {t("landing.eventsLink")}
          </Link>
          <Link href="/download" className="text-accent hover:underline">
            {t("landing.downloadLink")}
          </Link>
        </div>
      </section>

      <section
        className={`mx-auto grid w-full max-w-4xl gap-4 px-6 sm:grid-cols-3 ${
          crews.length ? "" : "pb-24"
        }`}
      >
        {features.map((n) => (
          <div key={n} className="rounded-md bg-surface px-5 py-5">
            <h2 className="font-semibold">{t(`landing.feature${n}.title`)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {t(`landing.feature${n}.body`)}
            </p>
          </div>
        ))}
      </section>

      {/* 크루 — 로그인 없이 둘러볼 수 있는 공개 크루 */}
      {crews.length > 0 && (
        <section className="mx-auto w-full max-w-4xl px-6 pb-24 pt-16">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div>
              <h2 className="text-xl font-extrabold tracking-tight">
                {t("landing.crewsTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {t("landing.crewsSub")}
              </p>
            </div>
            <Link
              href="/crews"
              className="shrink-0 text-sm font-bold text-accent hover:underline"
            >
              {t("landing.crewsAll")}
            </Link>
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {crews.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/crews/${c.slug}`}
                  className="flex items-center gap-3.5 rounded-xl border border-line bg-card px-4 py-3.5 transition-colors hover:border-line-strong hover:bg-card-hover"
                >
                  {c.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.logo_url}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-full border border-line-strong object-cover"
                    />
                  ) : (
                    <Avatar name={c.name} size={44} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-extrabold">
                      {c.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {c.location ? `${c.location} · ` : ""}
                      {c.member_count} {t("crew.members")}
                    </p>
                  </div>
                  <span aria-hidden className="shrink-0 text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
