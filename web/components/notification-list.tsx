"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Card, Chip } from "@/components/ui/crew-ui";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

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

/** 유형 색 — 목록에서 무슨 알림인지 색으로 먼저 걸러 보게 */
const TONE: Record<string, string> = {
  wod_reminder: "bg-accent/15 text-accent",
  ai_insight: "bg-info-bg text-info",
  ai_program: "bg-info-bg text-info",
  crew_join_request: "bg-success-bg text-success",
  exercise_request: "bg-success-bg text-success",
  new_follower: "bg-success-bg text-success",
  race_partner: "bg-[#2a1a10] text-[#f4a261]",
  race_imported: "bg-[#2a1a10] text-[#f4a261]",
  test: "bg-label-bg text-label",
};
const FALLBACK_TONE = "bg-line text-foreground/75";
/** 짧은 칩 라벨이 있는 유형. 새 유형이 생기면 사전에 없어도 원문 키로 뜬다. */
const CHIP_KEYS = Object.keys(TONE);

/**
 * 알림함 — 유형·읽음 필터 + 날짜 묶음 + 삭제.
 *
 * 지금까지 읽음 표시만 있고 지울 방법이 없어서 몇 달치가 그대로 쌓였다.
 * 목록을 훑는 게 목적이라 필터를 서버 왕복 없이 클라이언트에서 건다 —
 * 어차피 최근 100건만 들고 온다.
 */
export function NotificationList({ rows }: { rows: NotifRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 지운 행은 refresh 전에도 바로 사라지게 — 서버 왕복을 기다리면 먹통처럼 보인다 */
  const [gone, setGone] = useState<Set<string>>(new Set());
  /** 방금 읽은 것 — 링크를 누르면 곧바로 다른 화면으로 넘어가서
   *  router.refresh() 의 결과를 볼 틈이 없다. 화면부터 맞춰 둔다. */
  const [readNow, setReadNow] = useState<Set<string>>(new Set());

  const live = rows
    .filter((r) => !gone.has(r.id))
    .map((r) => (readNow.has(r.id) ? { ...r, unread: false } : r));
  const unread = live.filter((r) => r.unread);
  const typeKeys = [...new Set(live.map((r) => r.type_key ?? "other"))];

  const shown =
    filter === "all"
      ? live
      : filter === "unread"
        ? unread
        : live.filter((r) => (r.type_key ?? "other") === filter);

  const typeLabel = (key: string) =>
    CHIP_KEYS.includes(key) ? t(`notif.chip.${key}` as DictKey) : key;

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
    return run((uid) =>
      createClient()
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", uid)
        .is("read_at", null),
    );
  };

  /** 알림을 열면 읽은 것이다. 지금까지 "모두 읽음"을 누르기 전에는 아무리
   *  눌러 봐도 뱃지가 안 없어졌다 — read_at 을 쓰는 곳이 그 버튼뿐이었다.
   *  이동을 막지 않으려고 결과를 기다리지 않는다(실패해도 다음 방문에 다시 보인다). */
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

  const del = (id: string) =>
    run(
      (uid) =>
        createClient().from("notifications").delete().eq("id", id).eq("user_id", uid),
      [id],
    );

  /** 읽은 것만 지운다 — 안 읽은 걸 쓸어버리면 못 본 알림이 사라진다 */
  const clearRead = () => {
    const ids = live.filter((r) => !r.unread).map((r) => r.id);
    if (!ids.length) return;
    if (!window.confirm(t("notif.clearReadConfirm", { n: ids.length }))) return;
    return run(
      (uid) =>
        createClient()
          .from("notifications")
          .delete()
          .eq("user_id", uid)
          .not("read_at", "is", null),
      ids,
    );
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
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <Chip active={filter === "all"} onClick={() => setFilter("all")} count={live.length}>
            {t("crew.finKindAll")}
          </Chip>
          {unread.length > 0 && (
            <Chip
              active={filter === "unread"}
              onClick={() => setFilter("unread")}
              count={unread.length}
            >
              {t("notif.unread")}
            </Chip>
          )}
          {typeKeys.map((k) => (
            <Chip
              key={k}
              active={filter === k}
              onClick={() => setFilter(k)}
              count={live.filter((r) => (r.type_key ?? "other") === k).length}
            >
              {typeLabel(k)}
            </Chip>
          ))}
        </div>
        <span className="flex shrink-0 items-center gap-3">
          {unread.length > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={busy}
              className="text-[13px] text-muted hover:text-accent disabled:opacity-50"
            >
              {t("notif.markAll")}
            </button>
          )}
          {readCount > 0 && (
            <button
              type="button"
              onClick={clearRead}
              disabled={busy}
              className="text-[13px] text-muted hover:text-danger disabled:opacity-50"
            >
              {t("notif.clearRead")}
            </button>
          )}
        </span>
      </div>

      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}

      {!shown.length ? (
        <Card className="mt-4 px-4 py-12 text-center">
          <p className="text-sm text-muted">
            {t(live.length ? "crew.finFilterEmpty" : "notif.empty")}
          </p>
        </Card>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {[...byDay.keys()].map((day) => {
            const list = byDay.get(day)!;
            return (
              <section key={day}>
                <p className="mb-1.5 px-1 text-sm font-extrabold">
                  {list[0].day_label}
                </p>
                <Card className="divide-y divide-line overflow-hidden">
                  {list.map((n) => {
                    const key = n.type_key ?? "other";
                    const inner = (
                      <>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex flex-wrap items-center gap-2">
                            {n.unread && (
                              <span
                                aria-hidden
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-sunday"
                              />
                            )}
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                TONE[key] ?? FALLBACK_TONE
                              }`}
                            >
                              {typeLabel(key)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                              {n.title}
                            </span>
                            <span className="tabular shrink-0 text-xs text-muted">
                              {n.time_label}
                            </span>
                          </span>
                          {n.body && (
                            <span className="mt-1 block text-[13px] text-muted">
                              {n.body}
                            </span>
                          )}
                        </span>
                      </>
                    );
                    return (
                      <div
                        key={n.id}
                        className="flex items-start gap-2 pr-2 transition-colors hover:bg-card-hover"
                      >
                        {n.url ? (
                          <Link
                            href={n.url}
                            onClick={() => markRead(n.id, n.unread)}
                            className="flex min-w-0 flex-1 px-5 py-3.5"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markRead(n.id, n.unread)}
                            disabled={!n.unread}
                            className="flex min-w-0 flex-1 px-5 py-3.5 text-left disabled:cursor-default"
                          >
                            {inner}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => del(n.id)}
                          disabled={busy}
                          aria-label={t("common.delete")}
                          className="mt-3 shrink-0 p-2 text-xs text-muted transition-colors hover:text-danger disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
