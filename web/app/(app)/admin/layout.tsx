import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmin } from "@/lib/admin";
import { getT } from "@/lib/i18n";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAdmin } = await getAdmin();
  if (!isAdmin) notFound();
  const { t } = await getT();

  const tabs = [
    { href: "/admin", key: "admin.tabOverview" },
    { href: "/admin/users", key: "admin.tabUsers" },
    { href: "/admin/content", key: "admin.tabContent" },
    { href: "/admin/moderation", key: "admin.tabModeration" },
  ] as const;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="rounded bg-accent/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-accent">
          {t("nav.admin")}
        </span>
      </div>
      <nav className="mt-3 flex flex-wrap gap-2 border-b border-surface pb-3">
        {tabs.map((tb) => (
          <Link
            key={tb.href}
            href={tb.href}
            className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-foreground"
          >
            {t(tb.key as Parameters<typeof t>[0])}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
