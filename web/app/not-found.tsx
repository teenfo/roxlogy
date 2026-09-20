import Image from "next/image";
import Link from "next/link";
import { getT } from "@/lib/i18n";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="rx-state" id="main-content"><div className="rx-state-card">
      <Image src="/roxlogy-mark-inverse.svg" alt="ROXLOGY" width={56} height={56} />
      <div className="rx-state-code" aria-hidden="true">404</div>
      <h1>{t("notFound.title")}</h1><p>{t("notFound.desc")}</p>
      <Link href="/" className="rx-primary">{t("common.home")}</Link>
    </div></main>
  );
}
