import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { t } = await getT();

  return (
    <>
      <header className="border-b border-surface">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-black tracking-widest">ROXLOGY</span>
          </Link>
          <Link
            href="/sessions"
            className="text-sm text-muted hover:text-foreground"
          >
            {t("nav.sessions")}
          </Link>
          <Link
            href="/races"
            className="text-sm text-muted hover:text-foreground"
          >
            {t("nav.races")}
          </Link>
          <Link
            href="/events"
            className="hidden text-sm text-muted hover:text-foreground sm:block"
          >
            {t("nav.events")}
          </Link>
          <Link
            href="/exercises"
            className="hidden text-sm text-muted hover:text-foreground sm:block"
          >
            {t("nav.exercises")}
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <Link
              href="/settings/profile"
              className="text-sm text-muted hover:text-foreground"
            >
              {t("nav.profile")}
            </Link>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-sm text-muted hover:text-foreground"
              >
                {t("common.logout")}
              </button>
            </form>
          </div>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {children}
      </div>
    </>
  );
}
