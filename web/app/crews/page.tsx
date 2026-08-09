import Image from "next/image";
import Link from "next/link";
import { getCrewDirectory } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: `${t("crew.directoryTitle")} — Roxlogy`,
    description: t("crew.directorySub"),
  };
}

export default async function CrewDirectoryPage() {
  const [crews, user, { t }] = await Promise.all([
    getCrewDirectory(),
    getCachedUser(),
    getT(),
  ]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-surface bg-background">
        <nav className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={24} height={24} />
            <span className="text-xs font-black tracking-widest text-muted">
              ROXLOGY
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <LocaleSwitcher />
            {user ? (
              <Link
                href="/dashboard"
                className="text-sm text-muted hover:text-foreground"
              >
                {t("nav.dashboard")}
              </Link>
            ) : (
              <Link
                href="/login?next=/crews"
                className="text-sm text-muted hover:text-foreground"
              >
                {t("common.login")}
              </Link>
            )}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <h1 className="text-3xl font-black tracking-tight">
          {t("crew.directoryTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("crew.directorySub")}</p>

        {!crews.length ? (
          <p className="mt-8 rounded-md bg-surface px-4 py-12 text-center text-sm text-muted">
            {t("crew.directoryEmpty")}
          </p>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {crews.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/crews/${c.slug}`}
                  className="block rounded-md bg-surface px-5 py-4 transition-colors hover:bg-surface/70"
                >
                  <p className="truncate text-lg font-bold">{c.name}</p>
                  {c.tagline && (
                    <p className="mt-0.5 truncate text-xs font-semibold tracking-widest text-accent">
                      {c.tagline}
                    </p>
                  )}
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {c.location && <span>{c.location}</span>}
                    <span>
                      <b className="text-foreground">{c.member_count}</b>{" "}
                      {t("crew.members")}
                    </span>
                    <span>
                      <b className="text-foreground">{c.post_count}</b>{" "}
                      {t("crew.posts")}
                    </span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
