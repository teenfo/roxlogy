"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { roxNative } from "@/lib/native";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { pushSupported, currentSubscription, enablePush, disablePush, sendTest } from "@/lib/push/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Chip, Hint, Panel } from "@/components/rox/ui";

const TYPES = ["wod_reminder", "new_follower", "crew_join_request", "dues_unpaid", "exercise_request", "race_partner", "ai_insight", "ai_program"] as const;
type TypeKey = (typeof TYPES)[number];

/**
 * 알림 설정 — 시안 Settings(알림) Panel "받고 싶은 알림" 그대로: .rx-switch-row(b 종류 · small 받기/받지 않기 + Switch) × N · Hint.
 * 푸시 켜기/끄기·테스트·네이티브 권한·WOD 시각은 우리 것이라 첫 .rx-switch-row 와 Input 으로(§4).
 */
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
    dues_unpaid: true,
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
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

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
      const { data: prows } = await supabase.from("notification_prefs").select("type_key, enabled").eq("user_id", user.id);
      if (prows) {
        setPrefs((p) => {
          const next = { ...p };
          for (const r of prows) {
            if ((TYPES as readonly string[]).includes(r.type_key)) next[r.type_key as TypeKey] = r.enabled;
          }
          return next;
        });
      }
      const { data: prof } = await supabase.from("profiles").select("wod_reminder_time").eq("id", user.id).maybeSingle();
      if (prof?.wod_reminder_time) setWodTime(String(prof.wod_reminder_time).slice(0, 5)); // HH:MM
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
    const { error } = await supabase.from("notification_prefs").upsert({ user_id: user.id, type_key: key, enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id,type_key" });
    if (error) setErr(error.message);
  }

  async function saveWodTime(value: string) {
    setWodTime(value);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    const { error } = await supabase.from("profiles").update({ wod_reminder_time: value ? value : null, timezone: tz }).eq("id", user.id);
    if (error) setErr(error.message);
  }

  // 푸시가 꺼져 있어도 종류별 선호는 미리 정해둘 수 있다 — 흐리게만 보여준다.
  const pushOn = native ? nativeOn : subscribed;
  const canPush = native ? nativeConfigured : supported;
  const onLabel = native ? t("notif.native.enabled") : t("notif.enabled");
  const offLabel = native ? t("notif.native.enable") : t("notif.enablePush");

  return (
    <Panel title={t("settings.noticeTitle")} action={<Chip tone={pushOn ? "green" : "neutral"}>{pushOn ? onLabel : t("notif.pushOffDesc")}</Chip>}>
      <p>{t("notif.desc")}</p>
      {/* 푸시 켜기/끄기 — 첫 행. 지원하지 않는 브라우저·미설정 앱은 안내만 */}
      {native && !nativeConfigured ? (
        <Hint>{t("notif.native.preparing")}</Hint>
      ) : !canPush ? (
        <Hint>
          {t("notif.unsupported")} {t("notif.iosHint")}
        </Hint>
      ) : (
        <div className="rx-switch-row">
          <span>
            <b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Bell size={16} />
              {pushOn ? onLabel : offLabel}
            </b>
            <small>{pushOn ? t("notif.multiDevice") : t("notif.pushOffDesc")}</small>
          </span>
          <span className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap" }}>
            {pushOn && (
              <Button type="button" variant="ghost" size="sm" onClick={test} disabled={busy}>
                {t("notif.test")}
              </Button>
            )}
            <Button type="button" variant={pushOn ? "outline" : "default"} className={pushOn ? "" : "rx-primary"} size="sm" onClick={native ? (pushOn ? nativeDisable : nativeEnable) : toggleSubscribe} disabled={busy}>
              {pushOn ? t("notif.disable") : offLabel}
            </Button>
          </span>
        </div>
      )}

      {/* 종류별 선호 — 푸시가 꺼져 있으면 흐리게, 조작은 가능 */}
      <div style={pushOn || !canPush ? undefined : { opacity: 0.55 }}>
        {TYPES.map((k) => (
          <label className="rx-switch-row" key={k}>
            <span>
              <b>{t(`notif.type.${k}`)}</b>
              <small>{t(`notif.typeDesc.${k}` as DictKey)}</small>
              {/* WOD 시각은 별도 카드 대신 이 행 안에서 정한다 */}
              {k === "wod_reminder" && prefs[k] && (
                <small style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <Input type="time" value={wodTime} onChange={(e) => saveWodTime(e.target.value)} style={{ width: 130 }} aria-label={t("notif.wodTimeHint")} />
                  {t("notif.wodTimeHint")}
                </small>
              )}
            </span>
            <Switch checked={prefs[k]} onCheckedChange={(v) => setPref(k, v)} aria-label={t(`notif.type.${k}`)} />
          </label>
        ))}
      </div>

      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {note && <Hint>{note}</Hint>}
    </Panel>
  );
}
