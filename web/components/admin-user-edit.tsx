"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { DIVISIONS } from "@/lib/divisions";
import { dictLabel } from "@/lib/dict-label";

const input =
  "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

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
    "profile_token_locked",
    "profile_admin_only",
  ];
  for (const c of codes) {
    if (msg.includes(c)) return dictLabel(t as never, `admin.err.${c}`, msg);
  }
  if (msg.includes("field_not_editable"))
    return dictLabel(t as never, "admin.err.field_not_editable", msg);
  return msg;
}

const str = (v: string | number | null | undefined) => (v == null ? "" : String(v));

/** 관리자: 사용자 프로필 수정. 바뀐 항목만 admin_update_profile 로 보낸다.
 *  profiles 를 직접 UPDATE 하지 않는 이유는 그 경로가 mcp_token 까지
 *  열려 있기 때문 — RPC 가 수정 가능한 컬럼을 화이트리스트로 강제한다. */
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
    leaderboard_opt_in: user.leaderboard_opt_in,
    is_admin: user.is_admin,
    disabled: user.disabled,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof f, v: string | boolean) =>
    setF((p) => ({ ...p, [k]: v }));

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

    const { error } = await createClient().rpc("admin_update_profile", {
      p_user: user.id,
      p_patch: patch,
    });
    setBusy(false);
    if (error) return setErr(errText(t as never, error.message));
    setMsg(t("crew.saved"));
    router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-lg">
      <label className="block text-xs text-muted">{t("admin.fName")}</label>
      <input
        className={`${input} mt-1`}
        value={f.display_name}
        onChange={(e) => set("display_name", e.target.value)}
        maxLength={60}
      />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted">{t("admin.fDivision")}</label>
          <select
            className={`${input} mt-1`}
            value={f.division}
            onChange={(e) => set("division", e.target.value)}
          >
            <option value="">—</option>
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {dictLabel(t as never, `division.${d}`, d)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted">{t("pft.fGender")}</label>
          <select
            className={`${input} mt-1`}
            value={f.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            <option value="">—</option>
            <option value="male">{t("pft.male")}</option>
            <option value="female">{t("pft.female")}</option>
            <option value="other">{t("pft.other")}</option>
          </select>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-muted">{t("admin.fBirthYear")}</label>
          <input
            className={`${input} mt-1`}
            value={f.birth_year}
            onChange={(e) => set("birth_year", e.target.value)}
            inputMode="numeric"
            placeholder="1990"
          />
        </div>
        <div>
          <label className="block text-xs text-muted">{t("admin.fHeight")}</label>
          <input
            className={`${input} mt-1`}
            value={f.height_cm}
            onChange={(e) => set("height_cm", e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className="block text-xs text-muted">{t("admin.fWeight")}</label>
          <input
            className={`${input} mt-1`}
            value={f.weight_kg}
            onChange={(e) => set("weight_kg", e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-muted">{t("admin.fTimezone")}</label>
          <input
            className={`${input} mt-1`}
            value={f.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            placeholder="Asia/Seoul"
          />
        </div>
        <div>
          <label className="block text-xs text-muted">{t("admin.fLocale")}</label>
          <select
            className={`${input} mt-1`}
            value={f.locale}
            onChange={(e) => set("locale", e.target.value)}
          >
            <option value="">—</option>
            <option value="ko">한국어</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted">{t("admin.fWodTime")}</label>
          <input
            type="time"
            className={`${input} mt-1`}
            value={f.wod_reminder_time}
            onChange={(e) => set("wod_reminder_time", e.target.value)}
          />
        </div>
      </div>

      <label className="mt-4 block text-xs text-muted">{t("admin.fAthleteName")}</label>
      <input
        className={`${input} mt-1`}
        value={f.hyrox_athlete_name}
        onChange={(e) => set("hyrox_athlete_name", e.target.value)}
        maxLength={80}
      />
      <p className="mt-1 text-[11px] text-muted">{t("admin.fAthleteNameHint")}</p>

      <div className="mt-5 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.leaderboard_opt_in}
            onChange={(e) => set("leaderboard_opt_in", e.target.checked)}
          />
          {t("admin.fLeaderboard")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.is_admin}
            onChange={(e) => set("is_admin", e.target.checked)}
          />
          <span className="font-semibold text-accent">{t("admin.fIsAdmin")}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.disabled}
            onChange={(e) => set("disabled", e.target.checked)}
          />
          <span className="font-semibold text-red-400">{t("admin.fDisabled")}</span>
        </label>
      </div>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
      {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
      >
        {busy ? "…" : t("crew.save")}
      </button>
    </form>
  );
}
