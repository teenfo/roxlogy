"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Back, PageHead, Panel } from "@/components/rox/ui";

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
      ? "bg-accent text-accent-foreground"
      : "border border-line-strong text-foreground-2 hover:border-line-strong"
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
    <>
      {/* 시안 training.tsx ProgramNew 의 바깥 구조 — Back · PageHead · form-layout[기본 설정 | 계획 미리보기].
          폼 항목 자체는 시안보다 많은 우리 구성이라 Panel 안에 그대로 둔다(§4-1) */}
      <Back href="/programs" label={t("programs.title")} />
      <PageHead title={t("programs.newTitle")} description={t("programs.step1")} />
      <div className="rx-form-layout">
        {/* 폼 */}
        <Panel title={t("programs.newTitle")}>
        <div className="flex flex-col gap-[18px]" style={{ padding: "0 24px 24px" }}>
          <label className="flex flex-col gap-1.5">
            <span className={label}>
              {t("programs.fldTitle")} <span className="text-danger">*</span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("programs.titlePh")}
              maxLength={80}
              className="h-11 rounded-lg border border-line-strong bg-page px-3 text-base font-semibold outline-none placeholder:font-normal placeholder:text-muted-3 focus:border-accent-line"
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
              className="resize-y rounded-lg border border-line-strong bg-page px-3 py-2.5 text-sm outline-none placeholder:text-muted-3 focus:border-accent-line"
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
                  className="tabular h-9 w-24 rounded-lg border border-line-strong bg-page px-2.5 text-sm outline-none focus:border-accent-line"
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
                        ? "bg-accent text-accent-foreground"
                        : "border border-line-strong text-foreground-2 hover:border-line-strong"
                    }`}
                  >
                    {dowLabel(tag, d)}
                    <span
                      className={`text-[10px] font-semibold ${
                        on ? "text-accent-foreground/70" : "text-muted-2"
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
                  ? "bg-accent text-accent-foreground hover:brightness-95"
                  : "cursor-not-allowed bg-line-mid text-muted-2"
              }`}
            >
              {pending ? t("common.saving") : t("programs.createNext")}
            </button>
            <p className="text-center text-xs text-muted-2">{hint}</p>
          </div>
        </div>
        </Panel>

        {/* 미리보기 */}
        <aside>
        <Panel title={t("programs.preview")}>
        <div className="flex flex-col gap-2.5" style={{ padding: "0 24px 24px" }}>
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
        </div>
        </Panel>
        </aside>
      </div>
    </>
  );
}
