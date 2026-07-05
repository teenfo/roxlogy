import Image from "next/image";
import Link from "next/link";
import { getT } from "@/lib/i18n";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <Image src="/roxlogy-mark.svg" alt="" width={72} height={72} />
      <div className="text-center">
        <h1 className="text-2xl font-bold">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("notFound.desc")}</p>
      </div>
      <Link
        href="/"
        className="rounded-md bg-accent px-6 py-2.5 text-sm font-bold text-background hover:brightness-110"
      >
        {t("common.home")}
      </Link>
    </main>
  );
}
