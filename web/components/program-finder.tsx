"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { dictLabel } from "@/lib/dict-label";
import { wodTypeDot } from "@/lib/wod-type";
import { Avatar } from "@/components/ui/crew-ui";

export type ProgramCardData = {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  weeks: number | null;
  isPublic: boolean;
  active: boolean;
  /** 워크아웃이 있는 날 수 — "주 N회" 계산에 쓴다 */
  workoutDays: number;
  types: string[];
  createdAt: string;
  /** 커뮤니티 프로그램만 (public_program_stats) */
  ownerName: string | null;
  enrollCount: number | null;
};

const LEVELS = ["beginner", "intermediate", "advanced"] as const;

/** 내 프로그램 + 커뮤니티 프로그램 — 레벨 칩·검색은 클라이언트에서 즉시 반영 */
export function ProgramFinder({
  mine,
  community,
}: {
  mine: ProgramCardData[];
  community: ProgramCardData[];
}) {
  const { t } = useI18n();
  const [level, setLevel] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return community.filter((p) => {
      if (level && p.level !== level) return false;
      if (!needle) return true;
      return [p.title, p.description, p.ownerName]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    });
  }, [community, level, q]);

  const card = (p: ProgramCardData, showOwner: boolean) => (
    <li key={p.id}>
      <Link
        href={`/programs/${p.id}`}
        className="flex h-full flex-col gap-3 rounded-[14px] border border-line bg-card px-[18px] py-4 transition-colors hover:border-[#444] hover:bg-card-hover"
      >
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-extrabold">
                {p.title}
              </span>
              {p.active && (
                <span className="shrink-0 rounded-[5px] bg-accent px-1.5 py-0.5 text-[10px] font-extrabold text-background">
                  {t("programs.enrolled")}
                </span>
              )}
              {p.isPublic && !showOwner && (
                <span className="shrink-0 rounded-[5px] bg-label-bg px-1.5 py-0.5 text-[10px] font-bold text-label">
                  {t("programs.public")}
                </span>
              )}
            </span>
            {p.description && (
              <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-muted">
                {p.description}
              </span>
            )}
          </span>
          <span aria-hidden className="shrink-0 text-muted/60">
            ›
          </span>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted">
          {p.level && (
            <span className="rounded-md bg-line px-1.5 py-0.5 font-bold text-foreground/75">
              {dictLabel(t, `predict.level.${p.level}`, p.level)}
            </span>
          )}
          {p.weeks && <span>{t("programs.weeksN", { n: p.weeks })}</span>}
          {p.weeks && p.workoutDays > 0 && (
            <span className="tabular">
              {t("programs.perWeek", {
                n: Math.max(1, Math.round(p.workoutDays / p.weeks)),
              })}
            </span>
          )}
          {p.types.length > 0 && (
            <span className="flex items-center gap-1">
              {p.types.map((ty) => (
                <span
                  key={ty}
                  aria-hidden
                  className={`h-2 w-2 rounded-[2px] ${wodTypeDot(ty)}`}
                />
              ))}
            </span>
          )}
          {showOwner && p.ownerName && (
            <span className="ml-auto flex min-w-0 items-center gap-1.5">
              <Avatar name={p.ownerName} size={18} />
              <span className="truncate text-foreground/75">{p.ownerName}</span>
              {p.enrollCount != null && p.enrollCount > 0 && (
                <span className="shrink-0">
                  · {t("programs.enrolledN", { n: p.enrollCount })}
                </span>
              )}
            </span>
          )}
        </div>
      </Link>
    </li>
  );

  return (
    <>
      <section>
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-extrabold">{t("programs.mine")}</h2>
          <span className="text-[13px] text-muted">{mine.length}</span>
        </div>
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {mine.map((p) => card(p, false))}
          <li>
            <Link
              href="/programs/new"
              className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-line-strong text-center transition-colors hover:border-[#555]"
            >
              <span aria-hidden className="text-[22px] text-muted">
                +
              </span>
              <span className="text-[13px] font-semibold">
                {t("programs.create")}
              </span>
              <span className="px-4 text-xs text-muted [word-break:keep-all]">
                {t("programs.createHint")}
              </span>
            </Link>
          </li>
        </ul>
      </section>

      {community.length > 0 && (
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-extrabold">
              {t("programs.community")}
            </h2>
            <span className="text-[13px] text-muted">{community.length}</span>

            <span className="ml-auto flex flex-wrap items-center gap-1.5 max-md:ml-0 max-md:w-full">
              <button
                type="button"
                onClick={() => setLevel(null)}
                className={`flex h-[30px] items-center rounded-full px-3 text-xs font-semibold transition-colors ${
                  level === null
                    ? "bg-accent text-background"
                    : "border border-line-strong text-muted hover:text-foreground"
                }`}
              >
                {t("crew.all")}
              </button>
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevel(lv)}
                  className={`flex h-[30px] items-center rounded-full px-3 text-xs font-semibold transition-colors ${
                    level === lv
                      ? "bg-accent text-background"
                      : "border border-line-strong text-muted hover:text-foreground"
                  }`}
                >
                  {dictLabel(t, `predict.level.${lv}`, lv)}
                </button>
              ))}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("nav.searchPh")}
                className="h-[30px] w-[180px] min-w-0 rounded-full border border-line-strong bg-page px-3 text-xs outline-none transition-colors focus:border-accent max-md:w-full"
              />
            </span>
          </div>

          {!shown.length ? (
            <p className="mt-3 rounded-[14px] border border-dashed border-line-strong px-4 py-10 text-center text-[13px] text-muted">
              {t("programs.filterEmpty")}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {shown.map((p) => card(p, true))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
