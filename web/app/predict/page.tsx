import Image from "next/image";
import Link from "next/link";
import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { PredictForm } from "@/components/predict-form";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.predict"), description: t("predict.desc") };
}

export default async function PredictPage() {
  const { t } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <>
      <header className="border-b border-surface">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-black tracking-widest">ROXLOGY</span>
          </Link>
          <div className="flex items-center gap-4">
            <LocaleSwitcher compact />
            <Link
              href="/login"
              className="text-sm text-muted hover:text-foreground"
            >
              {t("common.login")}
            </Link>
          </div>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <PredictForm isLoggedIn={!!user} />
      </div>
    </>
  );
}
