"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import {
  pushSupported,
  currentSubscription,
  enablePush,
  disablePush,
  sendTest,
} from "@/lib/push/client";

const TYPES = ["wod_reminder", "new_follower"] as const;
type TypeKey = (typeof TYPES)[number];

export function NotificationSettings() {
  const { t } = useI18n();
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<TypeKey, boolean>>({
    wod_reminder: true,
    new_follower: true,
  });
  const [wodTime, setWodTime] = useState("");

  useEffect(() => {
    setSupported(pushSupported());
    (async () => {
      const sub = await currentSubscription();
      setSubscribed(!!sub);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: prows } = await supabase
        .from("notification_prefs")
        .select("type_key, enabled")
        .eq("user_id", user.id);
      if (prows) {
        setPrefs((p) => {
          const next = { ...p };
          for (const r of prows) {
            if ((TYPES as readonly string[]).includes(r.type_key))
              next[r.type_key as TypeKey] = r.enabled;
          }
          return next;
        });
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("wod_reminder_time")
        .eq("id", user.id)
        .maybeSingle();
      if (prof?.wod_reminder_time)
        setWodTime(String(prof.wod_reminder_time).slice(0, 5)); // HH:MM
    })();
  }, []);

  async function toggleSubscribe() {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else {
        const r = await enablePush();
        if (!r.ok) {
          setErr(r.reason === "denied" ? t("notif.denied") : t("notif.err"));
        } else {
          setSubscribed(true);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    const ok = await sendTest();
    setBusy(false);
    setNote(ok ? t("notif.testSent") : t("notif.err"));
  }

  async function setPref(key: TypeKey, enabled: boolean) {
    setPrefs((p) => ({ ...p, [key]: enabled }));
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("notification_prefs").upsert(
      { user_id: user.id, type_key: key, enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id,type_key" },
    );
  }

  async function saveWodTime(value: string) {
    setWodTime(value);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    await supabase
      .from("profiles")
      .update({ wod_reminder_time: value ? value : null, timezone: tz })
      .eq("id", user.id);
  }

  return (
    <section className="mt-6 max-w-md">
      <h2 className="text-lg font-bold">{t("notif.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("notif.desc")}</p>

      {!supported ? (
        <p className="mt-3 rounded-md bg-surface px-4 py-3 text-sm text-muted">
          {t("notif.unsupported")}
          <span className="mt-1 block text-xs">{t("notif.iosHint")}</span>
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          <div className="flex items-center justify-between gap-4 rounded-md bg-surface px-4 py-3 text-sm">
            <span>{subscribed ? t("notif.enabled") : t("notif.enablePush")}</span>
            <button
              type="button"
              onClick={toggleSubscribe}
              disabled={busy}
              className={
                subscribed
                  ? "rounded-md border border-muted/40 px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40"
                  : "rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110 disabled:opacity-40"
              }
            >
              {subscribed ? t("notif.disable") : t("notif.enablePush")}
            </button>
          </div>

          {subscribed && (
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className="justify-self-start rounded-md border border-muted/30 px-3 py-1.5 text-xs text-foreground hover:border-accent disabled:opacity-40"
            >
              {t("notif.test")}
            </button>
          )}

          {/* 종류별 선호 */}
          <div className="rounded-md bg-surface px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("notif.types")}
            </p>
            <div className="mt-2 grid gap-2">
              {TYPES.map((k) => (
                <label key={k} className="flex items-center justify-between gap-4 text-sm">
                  <span>{t(`notif.type.${k}`)}</span>
                  <input
                    type="checkbox"
                    checked={prefs[k]}
                    onChange={(e) => setPref(k, e.target.checked)}
                    className="accent-accent"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* WOD 리마인더 시각 (사용자 입력) */}
          <label className="flex flex-col gap-1.5 rounded-md bg-surface px-4 py-3 text-sm">
            <span className="flex items-center justify-between gap-4">
              {t("notif.wodTime")}
              <input
                type="time"
                value={wodTime}
                onChange={(e) => saveWodTime(e.target.value)}
                className="rounded-md border border-muted/30 bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
              />
            </span>
            <span className="text-xs text-muted">{t("notif.wodTimeHint")}</span>
          </label>

          {err && <p className="text-sm text-red-400">{err}</p>}
          {note && <p className="text-sm text-track">{note}</p>}
        </div>
      )}
    </section>
  );
}
