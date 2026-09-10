import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import { Card } from "@/components/ui/crew-ui";
import { MarkNotificationsRead } from "@/components/mark-notifications-read";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.notifications") };
}

type Row = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
  read_at: string | null;
};

/** 알림함 — 지금까지 알림은 푸시로만 갔고 앱 안에 쌓인 걸 볼 곳이 없었다. */
export default async function NotificationsPage() {
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // "내 알림" 이므로 user_id 필터 필수
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, url, created_at, read_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as Row[];
  const unread = rows.filter((r) => r.read_at == null);

  return (
    <main>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("nav.notifications")}</h1>
        {unread.length > 0 && (
          <>
            <span className="rounded-full bg-sunday px-2 py-0.5 text-[11px] font-bold text-background">
              {unread.length}
            </span>
            <MarkNotificationsRead className="ml-auto" />
          </>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error.message}</p>}

      {!rows.length ? (
        <Card className="mt-6 px-4 py-12 text-center">
          <p className="text-sm text-muted">{t("notif.empty")}</p>
        </Card>
      ) : (
        <Card className="mt-6 divide-y divide-line overflow-hidden">
          {rows.map((n) => {
            const body = (
              <>
                <span className="flex items-center gap-2">
                  {n.read_at == null && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-sunday"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                    {n.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {formatDateShort(n.created_at, tag, tz)}
                  </span>
                </span>
                {n.body && (
                  <span className="mt-1 block text-[13px] text-muted">
                    {n.body}
                  </span>
                )}
              </>
            );
            return n.url ? (
              <Link
                key={n.id}
                href={n.url}
                className="block px-5 py-3.5 transition-colors hover:bg-card-hover"
              >
                {body}
              </Link>
            ) : (
              <div key={n.id} className="px-5 py-3.5">
                {body}
              </div>
            );
          })}
        </Card>
      )}
    </main>
  );
}
