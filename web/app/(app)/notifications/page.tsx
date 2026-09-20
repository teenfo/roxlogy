import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { todayISOIn } from "@/lib/format";
import { NotificationList, type NotifRow } from "@/components/notification-list";

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

/** 알림함 — 시안 account.tsx Notifications() 는 NotificationList 가 통째로 그린다(모두 읽음 버튼이 상태를 쥔다). */
export default async function NotificationsPage() {
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // "내 알림" 이므로 user_id 필터 필수
  const { data, error } = await supabase.from("notifications").select("id, type_key, title, body, url, created_at, read_at").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(100);

  const raw = (data ?? []) as Row[];

  // 날짜 묶음·시각 표시는 사용자 시간대가 필요한데 클라이언트에는 tz 가 없다.
  // (useI18n 은 locale·tag 만 준다) 그래서 서버에서 미리 만들어 넘긴다.
  const dayKeyOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
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
        : new Date(`${key}T00:00:00`).toLocaleDateString(tag, { year: key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", month: "long", day: "numeric", weekday: "short" });
  const timeLabelOf = (iso: string) => new Date(iso).toLocaleTimeString(tag, { timeZone: tz || "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

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

  return <NotificationList rows={rows} loadError={error?.message ?? null} />;
}
