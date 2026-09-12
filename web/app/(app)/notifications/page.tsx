import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { todayISOIn } from "@/lib/format";
import { Card } from "@/components/ui/crew-ui";
import {
  NotificationList,
  type NotifRow,
} from "@/components/notification-list";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.notifications") };
}

type Row = {
  id: string;
  type_key: string | null;
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
    .select("id, type_key, title, body, url, created_at, read_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const raw = (data ?? []) as Row[];

  // 날짜 묶음·시각 표시는 사용자 시간대가 필요한데 클라이언트에는 tz 가 없다.
  // (useI18n 은 locale·tag 만 준다) 그래서 서버에서 미리 만들어 넘긴다.
  const dayKeyOf = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  const today = todayISOIn(tz);
  const yesterday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const dayLabelOf = (key: string) =>
    key === today
      ? t("notif.today")
      : key === yesterday
        ? t("notif.yesterday")
        : new Date(`${key}T00:00:00`).toLocaleDateString(tag, {
            year: key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
            month: "long",
            day: "numeric",
            weekday: "short",
          });
  const timeLabelOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(tag, {
      timeZone: tz || "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
    });

  const rows: NotifRow[] = raw.map((n) => {
    const key = dayKeyOf(n.created_at);
    return {
      id: n.id,
      type_key: n.type_key,
      title: n.title,
      body: n.body,
      url: n.url,
      unread: n.read_at == null,
      day_key: key,
      day_label: dayLabelOf(key),
      time_label: timeLabelOf(n.created_at),
    };
  });
  const unread = rows.filter((r) => r.unread).length;

  return (
    <main>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("nav.notifications")}</h1>
        {unread > 0 && (
          <span className="rounded-full bg-sunday px-2 py-0.5 text-xs font-bold text-background">
            {unread}
          </span>
        )}
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-danger">{error.message}</p>}

      {!rows.length ? (
        <Card className="mt-6 px-4 py-12 text-center">
          <p className="text-sm text-muted">{t("notif.empty")}</p>
        </Card>
      ) : (
        <NotificationList rows={rows} />
      )}
    </main>
  );
}
