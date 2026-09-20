"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Choice, Field, Hint, Panel } from "@/components/rox/ui";

const GENDERS = ["male", "female", "other"] as const;

/** '@user', 'instagram.com/user/', 전체 URL 어느 쪽을 붙여넣어도 핸들만 남긴다.
 *  DB 체크 제약(영문·숫자·마침표·밑줄 30자)이 최종 방어선. */
function igHandle(v: string): string | null {
  const h = v
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .trim();
  return h || null;
}

type ProfileFields = {
  display_name: string;
  gender: string;
  height_cm: string;
  weight_kg: string;
  birth_year: string;
  instagram: string;
  leaderboard_opt_in: boolean;
};

/**
 * 공개 프로필 — 시안 Settings(프로필) 그대로: form[Panel "공개 프로필"[ .rx-profile-editor(아바타 · 이름 · 설명) ·
 * .rx-form-grid(표시 이름 · 인스타그램) · .rx-switch-row 리더보드 · Button ]]. 성별·출생연도·신장·체중은 우리 칸(§4).
 */
export function ProfileForm({
  initial,
  currentYear,
  lastSaved,
}: {
  initial: ProfileFields;
  /** 나이 계산 기준 연도 — 렌더 중 new Date() 를 쓰지 않도록 서버에서 받는다 */
  currentYear: number;
  /** profiles.updated_at 을 서버 타임존으로 미리 포맷한 값 */
  lastSaved: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }

    const { error: err } = await supabase
      .from("profiles")
      .update({
        display_name: fields.display_name.trim() || null,
        gender: fields.gender || null,
        height_cm: fields.height_cm ? Number(fields.height_cm) : null,
        weight_kg: fields.weight_kg ? Number(fields.weight_kg) : null,
        birth_year: fields.birth_year ? Number(fields.birth_year) : null,
        instagram: igHandle(fields.instagram),
        leaderboard_opt_in: fields.leaderboard_opt_in,
      })
      .eq("id", user.id);

    setPending(false);
    if (err) return setError(t("profile.errSave", { msg: err.message }));
    setSaved(true);
    router.refresh();
  }

  // 나이는 출생연도에서 즉시 계산해 라벨 옆에 보여준다 (입력 검증용 힌트).
  const year = Number(fields.birth_year);
  const age = year >= 1920 && year <= 2020 ? currentYear - year : null;
  const name = fields.display_name.trim();

  return (
    <form onSubmit={handleSave}>
      <Panel title={t("settings.publicProfile")}>
        <div className="rx-profile-editor">
          <span className="rx-avatar" aria-hidden>
            {(name[0] ?? "?").toUpperCase()}
          </span>
          <div>
            <h3>{name || t("profile.displayName")}</h3>
            <p>{t("settings.nameHint")}</p>
          </div>
        </div>
        <div className="rx-form-grid">
          <Field label={t("profile.displayName")}>
            <Input required value={fields.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder={t("profile.displayName")} />
          </Field>
          <Field label={t("profile.instagram")}>
            <Input value={fields.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder={t("profile.instagramHint")} maxLength={80} />
          </Field>
          {/* 디비전은 세션·레이스 단위로 관리 (여러 디비전 출전 가능) — 프로필에서 제거 */}
          <Field label={t("profile.gender")}>
            <Choice
              label={t("profile.gender")}
              value={fields.gender || "none"}
              onChange={(v) => set("gender", v === "none" ? "" : v)}
              options={[["none", t("dash.unset")], ...GENDERS.map((g) => [g, t(`profile.gender.${g}`)] as [string, string])]}
            />
          </Field>
          <Field label={age !== null ? `${t("profile.birthYear")} · ${t("profile.ageN", { n: age })}` : t("profile.birthYear")}>
            <Input type="number" min={1920} max={2020} placeholder="1990" value={fields.birth_year} onChange={(e) => set("birth_year", e.target.value)} />
          </Field>
          <Field label={`${t("profile.heightShort")} (cm)`}>
            <Input type="number" min="0" step="0.1" value={fields.height_cm} onChange={(e) => set("height_cm", e.target.value)} />
          </Field>
          <Field label={`${t("profile.weightShort")} (kg)`}>
            <Input type="number" min="0" step="0.1" value={fields.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} />
          </Field>
        </div>
        <label className="rx-switch-row">
          <span>
            <b>{t("profile.leaderboardOptIn")}</b>
            <small>{t("profile.leaderboardOptInHint")}</small>
          </span>
          <Switch checked={fields.leaderboard_opt_in} onCheckedChange={(v) => set("leaderboard_opt_in", v)} aria-label={t("profile.leaderboardOptIn")} />
        </label>
        <Button type="submit" className="rx-primary" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
        {error ? (
          <p role="alert" className="rx-error">
            {error}
          </p>
        ) : saved || lastSaved ? (
          <Hint>{saved ? t("profile.saved") : t("profile.lastSaved", { date: lastSaved ?? "" })}</Hint>
        ) : null}
      </Panel>
    </form>
  );
}
