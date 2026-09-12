"use client";

import { useEffect, useRef, useState } from "react";
import { NavIcon } from "@/components/nav-icon";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { roxNative } from "@/lib/native";
import {
  SettingsCard,
  Toggle,
  btnGhost,
  btnPrimary,
} from "@/components/ui/settings-ui";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import {
  pushSupported,
  currentSubscription,
  enablePush,
  disablePush,
  sendTest,
} from "@/lib/push/client";

const TYPES = [
  "wod_reminder",
  "new_follower",
  "crew_join_request",
  "exercise_request",
  "race_partner",
  "ai_insight",
  "ai_program",
] as const;
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
    crew_join_request: true,
    exercise_request: true,
    race_partner: true,
    ai_insight: true,
    ai_program: true,
  });
  const [wodTime, setWodTime] = useState("");
  // 네이티브(앱) 푸시 상태
  const [native, setNative] = useState(false);
  const [nativeConfigured, setNativeConfigured] = useState(false);
  const [nativeOn, setNativeOn] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 권한 다이얼로그 폴링 정리 (언마운트 시)
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    (async () => {
      setSupported(pushSupported());
      const rn = roxNative();
      if (rn) {
        setNative(true);
        setNativeConfigured(!!rn.isConfigured?.());
        // isEnabled(권한+옵트아웃 반영)가 있으면 우선, 없으면(구버전) 권한만
        setNativeOn(rn.isEnabled ? !!rn.isEnabled() : !!rn.hasPermission?.());
      }
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
    const r = await sendTest();
    setBusy(false);
    setNote(r === "sent" ? t("notif.testSent") : r === "none" ? t("notif.testNone") : t("notif.err"));
  }

  function nativeEnable() {
    const rn = roxNative();
    if (!rn) return;
    rn.enable?.();
    setNote(t("notif.native.requested"));
    // 권한 다이얼로그는 비동기 — 잠시 폴링해 상태 반영.
    let n = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      n += 1;
      const on = rn.isEnabled ? rn.isEnabled() : rn.hasPermission?.();
      if (on) {
        setNativeOn(true);
        setNote(null);
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      } else if (n > 12) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 800);
  }

  function nativeDisable() {
    roxNative()?.disable?.();
    setNativeOn(false);
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

  // 푸시가 꺼져 있어도 종류별 선호는 미리 정해둘 수 있다 — 흐리게만 보여준다.
  const pushOn = native ? nativeOn : subscribed;
  const canPush = native ? nativeConfigured : supported;

  const banner = () => {
    if (native && !nativeConfigured)
      return (
        <p className="px-[22px] py-4 text-sm text-muted max-md:px-4">
          {t("notif.native.preparing")}
        </p>
      );
    if (!canPush)
      return (
        <div className="px-[22px] py-4 max-md:px-4">
          <p className="text-sm text-muted">{t("notif.unsupported")}</p>
          <p className="mt-1 text-xs text-muted">{t("notif.iosHint")}</p>
        </div>
      );

    const onLabel = native ? t("notif.native.enabled") : t("notif.enabled");
    const offLabel = native
      ? t("notif.native.enable")
      : t("notif.enablePush");

    return (
      <div
        className={`flex items-center gap-3.5 border-b border-line px-[22px] py-4 max-md:px-4 ${
          pushOn ? "bg-success-bg/15" : ""
        }`}
      >
        <span
          aria-hidden
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
            pushOn ? "bg-success-bg text-success" : "bg-line text-muted"
          }`}
        >
          <NavIcon name="bell" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{pushOn ? onLabel : offLabel}</p>
          <p className="mt-0.5 text-xs text-muted">
            {pushOn ? t("notif.multiDevice") : t("notif.pushOffDesc")}
          </p>
          {pushOn && (
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className="mt-1.5 text-xs font-bold text-accent hover:underline disabled:opacity-40"
            >
              {t("notif.test")}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={
            native
              ? pushOn
                ? nativeDisable
                : nativeEnable
              : toggleSubscribe
          }
          disabled={busy}
          className={pushOn ? btnGhost : btnPrimary}
        >
          {pushOn ? t("notif.disable") : offLabel}
        </button>
      </div>
    );
  };

  return (
    <SettingsCard
      id="notifications"
      title={t("notif.title")}
      desc={t("notif.desc")}
      bodyClassName="flex flex-col"
    >
      {banner()}

      {/* 종류별 선호 — 푸시가 꺼져 있으면 흐리게, 조작은 가능 */}
      <div className={pushOn || !canPush ? "" : "opacity-50"}>
        {TYPES.map((k) => (
          <div
            key={k}
            className="flex items-center gap-4 border-b border-line-soft px-[22px] py-2.5 last:border-b-0 max-md:px-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t(`notif.type.${k}`)}</p>
              <p className="mt-0.5 text-xs text-muted">
                {t(`notif.typeDesc.${k}` as DictKey)}
              </p>
              {/* WOD 시각은 별도 카드 대신 이 행 안에서 정한다 */}
              {k === "wod_reminder" && prefs[k] && (
                <label className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  <input
                    type="time"
                    value={wodTime}
                    onChange={(e) => saveWodTime(e.target.value)}
                    className="h-8 rounded-lg border border-line-strong bg-page px-2 text-sm text-foreground outline-none focus:border-accent"
                  />
                  <span>{t("notif.wodTimeHint")}</span>
                </label>
              )}
            </div>
            <Toggle
              checked={prefs[k]}
              onChange={(v) => setPref(k, v)}
              label={t(`notif.type.${k}`)}
            />
          </div>
        ))}
      </div>

      {(err || note) && (
        <p
          className={`px-[22px] py-3 text-xs max-md:px-4 ${err ? "text-danger" : "text-success"}`}
        >
          {err ?? note}
        </p>
      )}
    </SettingsCard>
  );
}
