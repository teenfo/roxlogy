import Image from "next/image";
import Link from "next/link";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { CrewCreateForm } from "@/components/crew-create-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("crew.createTitle")} — Roxlogy` };
}

export default async function CrewNewPage() {
  const [user, { t }] = await Promise.all([getCachedUser(), getT()]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-surface bg-background">
        <nav className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-4">
          <Link href="/crews" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={24} height={24} />
            <span className="text-xs font-black tracking-widest text-muted">
              ROXLOGY
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <LocaleSwitcher />
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-8">
        <h1 className="text-3xl font-black tracking-tight">
          {t("crew.createTitle")}
        </h1>
        {user ? (
          <CrewCreateForm />
        ) : (
          <p className="mt-6 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            <Link
              href="/login?next=/crews/new"
              className="text-accent hover:underline"
            >
              {t("common.login")}
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
