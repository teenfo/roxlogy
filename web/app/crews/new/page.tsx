import Link from "next/link";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/rox/shell";
import { CrewCreateForm } from "@/components/crew-create-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("crew.createTitle")} — Roxlogy` };
}

export default async function CrewNewPage() {
  const [user, { t }] = await Promise.all([getCachedUser(), getT()]);

  return (
    <Shell loginNext="/crews/new">
      <div className="mx-auto w-full max-w-lg flex-1 px-6 py-8">
        <h1 className="text-[30px] font-extrabold leading-[1.4] tracking-[-1px] max-[1000px]:text-[27px] max-[600px]:text-[25px]">
          {t("crew.createTitle")}
        </h1>
        {user ? (
          <CrewCreateForm />
        ) : (
          <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
            <Link
              href="/login?next=/crews/new"
              className="text-gold hover:underline"
            >
              {t("common.login")}
            </Link>
          </p>
        )}
      </div>
    </Shell>
  );
}
