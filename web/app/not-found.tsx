import { getT } from "@/lib/i18n";
import { Go } from "@/components/rox/ui";

/** 시안 NotFoundScreen 그대로 (.rx-state-page, PORT_PLAN §3-a) */
export default async function NotFound() {
  const { t } = await getT();
  return (
    <section className="rx-state-page">
      <div>
        <span className="rx-error-number">404</span>
        <h1>{t("notFound.title")}</h1>
        <p>{t("notFound.desc")}</p>
        <div className="rx-actions">
          <Go href="/dashboard" primary>
            {t("nav.dashboard")}
          </Go>
          <Go href="/">{t("common.home")}</Go>
        </div>
      </div>
    </section>
  );
}
