"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Bell, Check, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Empty, PageHead, Panel, Segments } from "@/components/rox/ui";

export type NotifRow = {
  id: string;
  type_key: string | null;
  title: string;
  body: string | null;
  url: string | null;
  unread: boolean;
  /** 서버가 사용자 시간대로 계산해 넘긴다 — 클라이언트에는 tz 가 없다 */
  day_key: string;
  day_label: string;
  time_label: string;
};

/** 짧은 칩 라벨이 있는 유형. 새 유형이 생기면 사전에 없어도 원문 키로 뜬다. */
const CHIP_KEYS = ["wod_reminder", "ai_insight", "ai_program", "crew_join_request", "exercise_request", "new_follower", "race_partner", "race_imported", "test"];

/**
 * 알림함 — 시안 account.tsx Notifications() 그대로 (PORT_PLAN §3-f):
 * PageHead(+ Button 모두 읽음) · Panel[ Segments(전체 · 유형…) · .rx-notification(아이콘 · 제목/본문/시각 · 미읽음 점 · 화살표) ].
 * 읽음 필터·날짜 묶음·삭제·읽은 알림 지우기는 우리 것(§4). 필터는 서버 왕복 없이 건다 — 어차피 최근 100건만 들고 온다.
 */
export function NotificationList({ rows, loadError }: { rows: NotifRow[]; loadError?: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(loadError ?? null);
  /** 지운 행은 refresh 전에도 바로 사라지게 — 서버 왕복을 기다리면 먹통처럼 보인다 */
  const [gone, setGone] = useState<Set<string>>(new Set());
  /** 방금 읽은 것 — 링크를 누르면 곧바로 다른 화면으로 넘어가서
   *  router.refresh() 의 결과를 볼 틈이 없다. 화면부터 맞춰 둔다. */
  const [readNow, setReadNow] = useState<Set<string>>(new Set());

  const live = rows.filter((r) => !gone.has(r.id)).map((r) => (readNow.has(r.id) ? { ...r, unread: false } : r));
  const unread = live.filter((r) => r.unread);
  const typeKeys = [...new Set(live.map((r) => r.type_key ?? "other"))];

  const shown = filter === "all" ? live : filter === "unread" ? unread : live.filter((r) => (r.type_key ?? "other") === filter);

  const typeLabel = (key: string) => (CHIP_KEYS.includes(key) ? t(`notif.chip.${key}` as DictKey) : key);

  async function run(fn: (uid: string) => PromiseLike<unknown>, ids?: string[]) {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return setBusy(false);
    const res = (await fn(u.user.id)) as { error?: { message: string } | null };
    setBusy(false);
    if (res?.error) return setErr(res.error.message);
    if (ids) setGone((s) => new Set([...s, ...ids]));
    router.refresh();
  }

  const markAll = () => {
    setReadNow((s) => new Set([...s, ...unread.map((r) => r.id)]));
    return run((uid) => createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", uid).is("read_at", null));
  };

  /** 알림을 열면 읽은 것이다. 이동을 막지 않으려고 결과를 기다리지 않는다(실패해도 다음 방문에 다시 보인다). */
  function markRead(id: string, wasUnread: boolean) {
    if (!wasUnread || readNow.has(id)) return;
    setReadNow((s) => new Set(s).add(id));
    void createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .then(({ error }) => {
        if (error) setErr(error.message);
        else router.refresh();
      });
  }

  const del = (id: string) => run((uid) => createClient().from("notifications").delete().eq("id", id).eq("user_id", uid), [id]);

  /** 읽은 것만 지운다 — 안 읽은 걸 쓸어버리면 못 본 알림이 사라진다 */
  const clearRead = () => {
    const ids = live.filter((r) => !r.unread).map((r) => r.id);
    if (!ids.length) return;
    if (!window.confirm(t("notif.clearReadConfirm", { n: ids.length }))) return;
    return run((uid) => createClient().from("notifications").delete().eq("user_id", uid).not("read_at", "is", null), ids);
  };

  // 날짜 묶음 — 목록이 길어서 "언제 온 것"이 먼저 보여야 한다
  const byDay = new Map<string, NotifRow[]>();
  for (const r of shown) {
    const arr = byDay.get(r.day_key) ?? [];
    arr.push(r);
    byDay.set(r.day_key, arr);
  }
  const readCount = live.length - unread.length;

  return (
    <>
      <PageHead
        title={t("notif.hero")}
        description={t("notif.heroDesc")}
        action={
          <div className="rx-actions" style={{ marginTop: 0 }}>
            {readCount > 0 && (
              <Button type="button" variant="ghost" onClick={clearRead} disabled={busy}>
                <Trash2 size={16} />
                {t("notif.clearRead")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={markAll} disabled={busy || unread.length === 0}>
              <Check size={16} />
              {t("notif.markAll")}
            </Button>
          </div>
        }
      />
      <Panel>
        <Segments
          label={t("nav.notifications")}
          value={filter}
          onChange={setFilter}
          options={[
            ["all", `${t("crew.finKindAll")} ${live.length}`],
            ...(unread.length > 0 ? [["unread", `${t("notif.unread")} ${unread.length}`] as [string, string]] : []),
            ...typeKeys.map((k) => [k, `${typeLabel(k)} ${live.filter((r) => (r.type_key ?? "other") === k).length}`] as [string, string]),
          ]}
        />
        {err && (
          <p role="alert" className="rx-error">
            {err}
          </p>
        )}
        {!shown.length ? (
          <Empty title={t(live.length ? "crew.finFilterEmpty" : "notif.empty")} description={t("notif.heroDesc")} />
        ) : (
          [...byDay.keys()].map((day) => {
            const list = byDay.get(day)!;
            return (
              <section key={day}>
                <p className="rx-muted" style={{ marginTop: 20, fontSize: 13, fontWeight: 600 }}>
                  {list[0].day_label}
                </p>
                {list.map((n) => {
                  const key = n.type_key ?? "other";
                  const inner = (
                    <>
                      <span className="rx-workout-icon">
                        <Bell size={19} />
                      </span>
                      <div>
                        <h3>{n.title}</h3>
                        {n.body && <p>{n.body}</p>}
                        <small>
                          {typeLabel(key)} · {n.time_label}
                        </small>
                      </div>
                      {n.unread && <i />}
                    </>
                  );
                  return (
                    <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {n.url ? (
                        <Link className={"rx-notification " + (n.unread ? "" : "read")} href={n.url} onClick={() => markRead(n.id, n.unread)} style={{ flex: 1, minWidth: 0 }}>
                          {inner}
                          <ArrowRight size={17} />
                        </Link>
                      ) : (
                        <button type="button" className={"rx-notification " + (n.unread ? "" : "read")} onClick={() => markRead(n.id, n.unread)} disabled={!n.unread} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: 0, borderTop: "1px solid #ecf0f3" }}>
                          {inner}
                        </button>
                      )}
                      <Button type="button" variant="ghost" size="icon" onClick={() => del(n.id)} disabled={busy} aria-label={t("common.delete")}>
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  );
                })}
              </section>
            );
          })
        )}
      </Panel>
    </>
  );
}
