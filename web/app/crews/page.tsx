import Link from "next/link";
import { getCrewDirectory } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { CrewHeader } from "@/components/crew-header";

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: `${t("crew.directoryTitle")} — Roxlogy`,
    description: t("crew.directorySub"),
  };
}

export default async function CrewDirectoryPage() {
  const [crews, { t }] = await Promise.all([getCrewDirectory(), getT()]);

  return (
    <>
      <CrewHeader loginNext="/crews" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              {t("crew.directoryTitle")}
            </h1>
            <p className="mt-1 text-sm text-muted">{t("crew.directorySub")}</p>
          </div>
          <Link
            href="/crews/new"
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
          >
            {t("crew.createCta")}
          </Link>
        </div>

        {!crews.length ? (
          <p className="mt-8 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
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
                  <div className="flex items-center gap-3">
                    {c.logo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.logo_url}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold">{c.name}</p>
                      {c.tagline && (
                        <p className="mt-0.5 truncate text-xs font-semibold tracking-widest text-accent">
                          {c.tagline}
                        </p>
                      )}
                    </div>
                  </div>
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
