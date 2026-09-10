"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import {
  InitialAvatar,
  SettingsCard,
  Toggle,
  btnPrimary,
  inputCls,
  labelCls,
} from "@/components/ui/settings-ui";

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

/** 우측에 단위를 얹은 숫자 입력 (신장 cm · 체중 kg) */
function UnitInput({
  unit,
  ...props
}: { unit: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="relative flex min-w-0 items-center">
      <input {...props} className={`${inputCls} pr-9`} />
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 text-xs text-muted"
      >
        {unit}
      </span>
    </span>
  );
}

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

  return (
    <form onSubmit={handleSave}>
      <SettingsCard
        id="profile"
        title={t("profile.secProfile")}
        desc={t("profile.secProfileDesc")}
        footer={
          <>
            <button type="submit" disabled={pending} className={btnPrimary}>
              {t("common.save")}
            </button>
            <span
              className={`text-xs ${
                error ? "text-danger" : saved ? "text-success" : "text-muted"
              }`}
            >
              {error
                ? error
                : pending
                  ? t("common.saving")
                  : saved
                    ? t("profile.saved")
                    : lastSaved
                      ? t("profile.lastSaved", { date: lastSaved })
                      : ""}
            </span>
          </>
        }
      >
        {/* 이름 — 아바타 이니셜이 입력과 함께 바뀐다 */}
        <div className="flex items-center gap-3.5">
          <InitialAvatar name={fields.display_name || "?"} size={64} />
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("profile.displayName")}</span>
            <input
              value={fields.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              placeholder={t("profile.displayName")}
              className={`${inputCls} text-[15px] font-semibold`}
            />
          </label>
        </div>

        {/* 디비전은 세션·레이스 단위로 관리 (여러 디비전 출전 가능) — 프로필에서 제거 */}
        <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
          <label className={labelCls}>
            {t("profile.gender")}
            <select
              value={fields.gender}
              onChange={(e) => set("gender", e.target.value)}
              className={inputCls}
            >
              <option value="">{t("dash.unset")}</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {t(`profile.gender.${g}`)}
                </option>
              ))}
            </select>
          </label>

          <label className={labelCls}>
            <span>
              {t("profile.birthYear")}
              {age !== null && (
                <span className="text-muted/70"> · {t("profile.ageN", { n: age })}</span>
              )}
            </span>
            <input
              type="number"
              min={1920}
              max={2020}
              placeholder="1990"
              value={fields.birth_year}
              onChange={(e) => set("birth_year", e.target.value)}
              className={inputCls}
            />
          </label>

          {/* 숫자 입력은 고유 폭(약 200px)이 있어 min-w-0 없이는 모바일에서
              한 줄 최소 폭이 컨테이너를 넘어 페이지 가로 오버플로를 일으킨다 */}
          <label className={labelCls}>
            {t("profile.heightShort")}
            <UnitInput
              unit="cm"
              type="number"
              min="0"
              step="0.1"
              value={fields.height_cm}
              onChange={(e) => set("height_cm", e.target.value)}
            />
          </label>
          <label className={labelCls}>
            {t("profile.weightShort")}
            <UnitInput
              unit="kg"
              type="number"
              min="0"
              step="0.1"
              value={fields.weight_kg}
              onChange={(e) => set("weight_kg", e.target.value)}
            />
          </label>
        </div>

        <label className={labelCls}>
          {t("profile.instagram")}
          <span className="flex h-[42px] items-center rounded-lg border border-line-strong bg-page focus-within:border-accent">
            <span className="pl-3 text-sm text-muted">@</span>
            <input
              value={fields.instagram}
              onChange={(e) => set("instagram", e.target.value)}
              placeholder="roxlogy"
              maxLength={80}
              className="w-full min-w-0 bg-transparent px-2 text-sm text-foreground outline-none"
            />
          </span>
          <span className="text-[11px] text-muted/80">
            {t("profile.instagramHint")}
          </span>
        </label>

        {/* 리더보드 표시 — 켜짐이 한눈에 보이도록 카드 자체가 색을 바꾼다 */}
        <div
          className={`flex items-center gap-4 rounded-[10px] border px-4 py-3.5 ${
            fields.leaderboard_opt_in
              ? "border-line-accent bg-highlight"
              : "border-line bg-inset"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{t("profile.leaderboardOptIn")}</p>
            <p className="mt-0.5 text-xs text-muted">
              {t("profile.leaderboardOptInHint")}
            </p>
          </div>
          <Toggle
            checked={fields.leaderboard_opt_in}
            onChange={(v) => set("leaderboard_opt_in", v)}
            label={t("profile.leaderboardOptIn")}
          />
        </div>
      </SettingsCard>
    </form>
  );
}
