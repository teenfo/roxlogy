"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { DIVISIONS } from "@/lib/divisions";
import { dictLabel } from "@/lib/dict-label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Choice, Field, Hint } from "@/components/rox/ui";

export type AdminUserDetail = {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string;
  display_name: string | null;
  division: string | null;
  gender: string | null;
  birth_year: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  timezone: string | null;
  locale: string | null;
  wod_reminder_time: string | null;
  hyrox_athlete_name: string | null;
  instagram: string | null;
  leaderboard_opt_in: boolean;
  is_admin: boolean;
  disabled: boolean;
  has_mcp_token: boolean;
  session_count: number;
  last_session_at: string | null;
  race_count: number;
  pft_count: number;
  program_count: number;
  crews: {
    slug: string;
    name: string;
    role: string;
    status: string;
    tier: string | null;
  }[];
};

/** RPC 는 로케일 중립 코드를 던진다 — 화면에서 사전으로 번역한다. */
function errText(t: (k: never) => string, msg: string): string {
  const codes = [
    "admin_only",
    "user_not_found",
    "admin_self_demote",
    "admin_self_disable",
    "bad_division",
    "bad_gender",
    "bad_locale",
    "bad_timezone",
    "bad_instagram",
    "profile_token_locked",
    "profile_admin_only",
  ];
  for (const c of codes) {
    if (msg.includes(c)) return dictLabel(t as never, `admin.err.${c}`, msg);
  }
  if (msg.includes("field_not_editable")) return dictLabel(t as never, "admin.err.field_not_editable", msg);
  return msg;
}

const str = (v: string | number | null | undefined) => (v == null ? "" : String(v));

/** 관리자: 사용자 프로필 수정. 바뀐 항목만 admin_update_profile 로 보낸다.
 *  profiles 를 직접 UPDATE 하지 않는 이유는 그 경로가 mcp_token 까지
 *  열려 있기 때문 — RPC 가 수정 가능한 컬럼을 화이트리스트로 강제한다.
 *  시안 프리미티브(Field·Choice·Input·rx-check·Button)로만 그린다. */
export function AdminUserEdit({ user }: { user: AdminUserDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({
    display_name: str(user.display_name),
    division: str(user.division),
    gender: str(user.gender),
    birth_year: str(user.birth_year),
    height_cm: str(user.height_cm),
    weight_kg: str(user.weight_kg),
    timezone: str(user.timezone),
    locale: str(user.locale),
    wod_reminder_time: str(user.wod_reminder_time).slice(0, 5),
    hyrox_athlete_name: str(user.hyrox_athlete_name),
    instagram: str(user.instagram),
    leaderboard_opt_in: user.leaderboard_opt_in,
    is_admin: user.is_admin,
    disabled: user.disabled,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  // Choice 는 빈 값을 못 쓴다 — "none" 을 빈 문자열로 오간다
  const opt = (v: string) => (v === "none" ? "" : v);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);

    // 바뀐 항목만 보낸다 — 안 건드린 컬럼은 RPC 가 그대로 둔다
    const patch: Record<string, unknown> = {};
    const orig: Record<string, string | boolean> = {
      display_name: str(user.display_name),
      division: str(user.division),
      gender: str(user.gender),
      birth_year: str(user.birth_year),
      height_cm: str(user.height_cm),
      weight_kg: str(user.weight_kg),
      timezone: str(user.timezone),
      locale: str(user.locale),
      wod_reminder_time: str(user.wod_reminder_time).slice(0, 5),
      hyrox_athlete_name: str(user.hyrox_athlete_name),
      instagram: str(user.instagram),
      leaderboard_opt_in: user.leaderboard_opt_in,
      is_admin: user.is_admin,
      disabled: user.disabled,
    };
    for (const [k, v] of Object.entries(f)) {
      if (v !== orig[k]) patch[k] = v;
    }
    if (!Object.keys(patch).length) {
      setBusy(false);
      return setMsg(t("admin.noChanges"));
    }

    const { error } = await createClient().rpc("admin_update_profile", { p_user: user.id, p_patch: patch });
    setBusy(false);
    if (error) return setErr(errText(t as never, error.message));
    setMsg(t("crew.saved"));
    router.refresh();
  }

  return (
    <form onSubmit={save}>
      <div className="rx-form-grid">
        <Field label={t("admin.fName")}>
          <Input value={f.display_name} onChange={(e) => set("display_name", e.target.value)} maxLength={60} />
        </Field>
        <Field label={t("admin.fAthleteName")}>
          <Input value={f.hyrox_athlete_name} onChange={(e) => set("hyrox_athlete_name", e.target.value)} maxLength={80} />
        </Field>
        <Field label={t("admin.fDivision")}>
          <Choice label={t("admin.fDivision")} value={f.division || "none"} onChange={(v) => set("division", opt(v))} options={[["none", "—"], ...DIVISIONS.map((d) => [d, dictLabel(t as never, `division.${d}`, d)] as [string, string])]} />
        </Field>
        <Field label={t("pft.fGender")}>
          <Choice
            label={t("pft.fGender")}
            value={f.gender || "none"}
            onChange={(v) => set("gender", opt(v))}
            options={[
              ["none", "—"],
              ["male", t("pft.male")],
              ["female", t("pft.female")],
              ["other", t("pft.other")],
            ]}
          />
        </Field>
        <Field label={t("admin.fBirthYear")}>
          <Input value={f.birth_year} onChange={(e) => set("birth_year", e.target.value)} inputMode="numeric" placeholder="1990" />
        </Field>
        <Field label={t("admin.fHeight")}>
          <Input value={f.height_cm} onChange={(e) => set("height_cm", e.target.value)} inputMode="decimal" />
        </Field>
        <Field label={t("admin.fWeight")}>
          <Input value={f.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} inputMode="decimal" />
        </Field>
        <Field label={t("admin.fTimezone")}>
          <Input value={f.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="Asia/Seoul" />
        </Field>
        <Field label={t("admin.fLocale")}>
          <Choice
            label={t("admin.fLocale")}
            value={f.locale || "none"}
            onChange={(v) => set("locale", opt(v))}
            options={[
              ["none", "—"],
              ["ko", "한국어"],
              ["en", "English"],
              ["es", "Español"],
            ]}
          />
        </Field>
        <Field label={t("admin.fWodTime")}>
          <Input type="time" value={f.wod_reminder_time} onChange={(e) => set("wod_reminder_time", e.target.value)} />
        </Field>
        <Field label={t("profile.instagram")}>
          <Input value={f.instagram} onChange={(e) => set("instagram", e.target.value)} maxLength={80} placeholder="roxlogy" />
        </Field>
      </div>
      <Hint>{t("admin.fAthleteNameHint")}</Hint>
      <label className="rx-check">
        <Checkbox checked={f.leaderboard_opt_in} onCheckedChange={(v) => set("leaderboard_opt_in", v === true)} />
        {t("admin.fLeaderboard")}
      </label>
      <label className="rx-check">
        <Checkbox checked={f.is_admin} onCheckedChange={(v) => set("is_admin", v === true)} />
        <b>{t("admin.fIsAdmin")}</b>
      </label>
      <label className="rx-check">
        <Checkbox checked={f.disabled} onCheckedChange={(v) => set("disabled", v === true)} />
        <b className="rx-error">{t("admin.fDisabled")}</b>
      </label>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {msg && <Hint>{msg}</Hint>}
      <Button type="submit" className="rx-primary" disabled={busy}>
        {busy ? t("common.saving") : t("crew.save")}
      </Button>
    </form>
  );
}
