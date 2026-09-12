"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;
const WEEK_CHIPS = [4, 6, 8, 12] as const;
/** 0=월 … 6=일 — DB programs.week_pattern 과 같은 규약 */
const DOW = [0, 1, 2, 3, 4, 5, 6] as const;
const DEFAULT_PATTERN = [0, 2, 4];

/** 요일 이름은 사전 대신 Intl 로 — 2024-01-01(월)을 기준으로 d 일 더한다.
 *  고정 날짜라 렌더 중에 만들어도 순수하다. */
export function dowLabel(tag: string, d: number): string {
  return new Date(Date.UTC(2024, 0, 1 + d)).toLocaleDateString(tag, {
    weekday: "short",
    timeZone: "UTC",
  });
}

const chip = (active: boolean) =>
  `flex h-9 items-center justify-center rounded-lg px-3.5 text-sm font-bold transition-colors ${
    active
      ? "bg-accent text-background"
      : "border border-line-strong text-[#c9c9c9] hover:border-muted/60"
  }`;

/**
 * 새 훈련 프로그램 — 기본 정보 + 주간 패턴.
 *
 * 저장하면 프로그램만 만드는 게 아니라 `weeks × 훈련요일` 만큼 일자를 미리
 * 만들어 둔다. 빈 프로그램을 받아 들고 "일자 추가"를 스무 번 누르는 게 지금까지
 * 제일 큰 마찰이었다.
 */
export function ProgramNewForm() {
  const router = useRouter();
  const { t, tag } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weeks, setWeeks] = useState<number>(8);
  const [customWeeks, setCustomWeeks] = useState(false);
  const [level, setLevel] = useState<string>("intermediate");
  const [pattern, setPattern] = useState<number[]>(DEFAULT_PATTERN);
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const perWeek = pattern.length;
  const totalDays = weeks > 0 ? weeks * perWeek : 0;
  const valid = title.trim().length > 0 && perWeek > 0 && weeks > 0;
  const hint = !title.trim()
    ? t("programs.errTitle")
    : perWeek === 0
      ? t("programs.errPattern")
      : t("programs.createHintNext");

  const toggleDay = (d: number) =>
    setPattern((p) =>
      p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort((a, b) => a - b),
    );

  async function handleSave() {
    setError(null);
    if (!valid) return;
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }
    const { data, error: err } = await supabase
      .from("programs")
      .insert({
        owner_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        weeks,
        level,
        is_public: isPublic,
        week_pattern: pattern,
      })
      .select("id")
      .single();
    if (err || !data) {
      setPending(false);
      return setError(t("programs.errSave", { msg: err?.message ?? "" }));
    }
    // 일자 미리 생성 — 실패해도 프로그램은 이미 만들어졌으니 빌더로 보낸다
    // (빌더에서 "훈련일 추가"로 이어 갈 수 있다)
    const rows = Array.from({ length: totalDays }, (_, i) => ({
      program_id: data.id,
      day_index: i + 1,
    }));
    const { error: dayErr } = await supabase.from("program_days").insert(rows);
    setPending(false);
    if (dayErr) return setError(t("programs.errSave", { msg: dayErr.message }));
    router.push(`/programs/${data.id}`);
    router.refresh();
  }

  const label = "text-xs font-bold tracking-[0.02em] text-muted";

  return (
    <main className="max-w-4xl pb-10">
      <Link href="/programs" className="text-[13px] text-muted hover:text-foreground">
        {t("programs.back")}
      </Link>
      <h1 className="mt-3 text-[28px] font-extrabold leading-tight">
        {t("programs.newTitle")}
      </h1>
      <p className="mt-1 text-xs text-muted-2">{t("programs.step1")}</p>

      <div className="mt-5 grid gap-3.5 md:grid-cols-[1fr_280px]">
        {/* 폼 */}
        <div className="flex flex-col gap-[18px] rounded-[14px] border border-line bg-card p-[22px] max-md:p-4">
          <label className="flex flex-col gap-1.5">
            <span className={label}>
              {t("programs.fldTitle")} <span className="text-danger">*</span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("programs.titlePh")}
              maxLength={80}
              className="h-11 rounded-lg border border-line-strong bg-page px-3 text-base font-semibold outline-none placeholder:font-normal placeholder:text-muted-3 focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>{t("programs.fldDesc")}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t("programs.descPh")}
              maxLength={400}
              className="resize-y rounded-lg border border-line-strong bg-page px-3 py-2.5 text-sm outline-none placeholder:text-muted-3 focus:border-accent"
            />
          </label>

          <div className="grid gap-[18px] sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className={label}>{t("programs.fldWeeks")}</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEK_CHIPS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => {
                      setWeeks(w);
                      setCustomWeeks(false);
                    }}
                    className={chip(!customWeeks && weeks === w)}
                  >
                    {t("programs.weeksN", { n: w })}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomWeeks(true)}
                  className={chip(customWeeks)}
                >
                  {t("programs.weeksCustom")}
                </button>
              </div>
              {customWeeks && (
                <input
                  value={weeks || ""}
                  onChange={(e) =>
                    setWeeks(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)
                  }
                  inputMode="numeric"
                  autoFocus
                  placeholder="10"
                  className="tabular h-9 w-24 rounded-lg border border-line-strong bg-page px-2.5 text-sm outline-none focus:border-accent"
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className={label}>{t("programs.fldLevel")}</span>
              <div className="flex flex-wrap gap-1.5">
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLevel(l)}
                    className={chip(level === l)}
                  >
                    {t(`predict.level.${l}` as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 주간 패턴 */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={label}>{t("programs.fldPattern")}</span>
              <span className="text-xs text-muted-2">
                {t("programs.patternHint")}
              </span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {DOW.map((d) => {
                const on = pattern.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    aria-pressed={on}
                    className={`flex h-11 flex-col items-center justify-center rounded-lg text-sm font-bold transition-colors max-md:h-10 ${
                      on
                        ? "bg-accent text-background"
                        : "border border-line-strong text-[#c9c9c9] hover:border-muted/60"
                    }`}
                  >
                    {dowLabel(tag, d)}
                    <span
                      className={`text-[10px] font-semibold ${
                        on ? "text-background/70" : "text-muted-2"
                      }`}
                    >
                      {on ? t("programs.dowOn") : t("programs.dowOff")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 공개 공유 */}
          <button
            type="button"
            onClick={() => setIsPublic((v) => !v)}
            aria-pressed={isPublic}
            className={`flex items-center gap-3 rounded-[10px] border px-4 py-3.5 text-left transition-colors ${
              isPublic
                ? "border-line-accent bg-highlight"
                : "border-line bg-inset"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">
                {t("programs.fldPublic")}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {t("programs.publicHint")}
              </span>
            </span>
            <span
              className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors ${
                isPublic ? "bg-accent" : "bg-line-strong"
              }`}
            >
              <span
                className={`absolute top-[3px] h-5 w-5 rounded-full bg-background transition-all ${
                  isPublic ? "left-[23px]" : "left-[3px]"
                }`}
              />
            </span>
          </button>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!valid || pending}
              className={`flex h-[46px] items-center justify-center rounded-lg text-sm font-extrabold transition ${
                valid && !pending
                  ? "bg-accent text-background hover:brightness-110"
                  : "cursor-not-allowed bg-[#2a2a2a] text-muted-2"
              }`}
            >
              {pending ? t("common.saving") : t("programs.createNext")}
            </button>
            <p className="text-center text-xs text-muted-2">{hint}</p>
          </div>
        </div>

        {/* 미리보기 */}
        <aside className="flex h-fit flex-col gap-2.5 rounded-[14px] border border-line bg-card p-[18px] md:sticky md:top-5">
          <p className="text-xs font-extrabold tracking-[0.1em] text-muted">
            {t("programs.preview")}
          </p>
          <p
            className={`text-[17px] font-extrabold ${title.trim() ? "" : "text-muted-3"}`}
          >
            {title.trim() || t("programs.untitled")}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-line px-1.5 py-0.5 font-bold text-foreground/80">
              {t(`predict.level.${level}` as Parameters<typeof t>[0])}
            </span>
            <span className="text-muted">
              {t("programs.weeksN", { n: weeks || 0 })} ·{" "}
              {t("programs.perWeek", { n: perWeek })}
            </span>
          </p>
          <p className="mt-1 border-t border-line pt-2.5 text-xs text-muted-2">
            {t("programs.totalDaysHint", { n: totalDays })}
          </p>
        </aside>
      </div>
    </main>
  );
}
