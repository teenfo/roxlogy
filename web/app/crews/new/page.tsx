import Link from "next/link";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { CrewHeader } from "@/components/crew-header";
import { CrewCreateForm } from "@/components/crew-create-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("crew.createTitle")} — Roxlogy` };
}

export default async function CrewNewPage() {
  const [user, { t }] = await Promise.all([getCachedUser(), getT()]);

  return (
    <>
      <CrewHeader loginNext="/crews/new" />

      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-8">
        <h1 className="text-3xl font-black tracking-tight">
          {t("crew.createTitle")}
        </h1>
        {user ? (
          <CrewCreateForm />
        ) : (
          <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
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
