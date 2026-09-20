"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Dumbbell } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { dictLabel } from "@/lib/dict-label";
import { Chip, Choice, Empty, Find, Panel, Segments } from "@/components/rox/ui";

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
  /** 진행 중이면 오늘의 워크아웃 */
  todayTemplate: { id: string; title: string } | null;
};

const LEVELS = ["beginner", "intermediate", "advanced"] as const;

/**
 * 프로그램 목록 — 시안 training.tsx Programs 그대로: Segments(전체/진행 중/…) ·
 * .rx-card-grid 의 .rx-program-card(.rx-program-top.tone-n · .rx-card-body).
 * 검색·레벨 필터와 내/커뮤니티 구분은 시안에 없는 우리 기능이라 Panel 툴바로 둔다(§4-1).
 */
export function ProgramFinder({
  mine,
  community,
}: {
  mine: ProgramCardData[];
  community: ProgramCardData[];
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState("all");
  const [level, setLevel] = useState("all");
  const [q, setQ] = useState("");

  const all = useMemo(
    () => [...mine.map((p) => ({ ...p, mine: true })), ...community.map((p) => ({ ...p, mine: false }))],
    [mine, community],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((p) => {
      if (tab === "running" && !p.active) return false;
      if (tab === "mine" && !p.mine) return false;
      if (tab === "community" && p.mine) return false;
      if (level !== "all" && p.level !== level) return false;
      if (!needle) return true;
      return [p.title, p.description, p.ownerName]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    });
  }, [all, tab, level, q]);

  return (
    <>
      <Segments
        value={tab}
        onChange={setTab}
        label={t("programs.title")}
        options={[
          ["all", t("programs.fltAll")],
          ["running", t("programs.running")],
          ["mine", t("programs.mine")],
          ["community", t("programs.community")],
        ]}
      />
      <Panel>
        <div className="rx-toolbar">
          <Find value={q} onChange={setQ} placeholder={t("programs.searchPh")} />
          <Choice
            label={t("predict.level.label" as Parameters<typeof t>[0])}
            value={level}
            onChange={setLevel}
            options={[
              ["all", t("programs.allLevels")],
              ...LEVELS.map(
                (l) => [l, dictLabel(t, `predict.level.${l}`, l)] as [string, string],
              ),
            ]}
          />
        </div>
      </Panel>
      {shown.length ? (
        <div className="rx-card-grid">
          {shown.map((p, i) => (
            <Panel key={p.id} className="rx-program-card">
              <div className={"rx-program-top tone-" + (i % 3)}>
                <Dumbbell size={30} />
                <span>{String(i + 1).padStart(2, "0")} / TRAINING</span>
              </div>
              <div className="rx-card-body">
                <Chip tone={p.active ? "green" : "neutral"}>
                  {p.active
                    ? t("programs.running")
                    : p.mine
                      ? t("programs.mine")
                      : t("programs.community")}
                </Chip>
                <h2>{p.title}</h2>
                <p>
                  {p.description ||
                    [
                      p.level ? dictLabel(t, `predict.level.${p.level}`, p.level) : null,
                      p.ownerName,
                      p.enrollCount != null ? `${p.enrollCount}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                </p>
                {p.todayTemplate && (
                  <p>
                    <Link href={`/workouts/${p.todayTemplate.id}`}>
                      ▶ {t("programs.todayWorkout", { name: p.todayTemplate.title })}
                    </Link>
                  </p>
                )}
                <div className="rx-card-bottom">
                  <span>
                    {p.weeks ? t("programs.weeksProgram", { n: p.weeks }) : ""}
                    {p.weeks && p.workoutDays
                      ? ` · ${t("programs.perWeek", { n: Math.max(1, Math.round(p.workoutDays / p.weeks)) })}`
                      : ""}
                  </span>
                  <Link aria-label={t("programs.detailOf", { name: p.title })} href={`/programs/${p.id}`}>
                    <ArrowRight size={21} />
                  </Link>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel>
          <Empty
            title={tab === "mine" ? t("programs.mineEmpty") : t("exercises.noResults")}
            description={t("programs.intro")}
          />
        </Panel>
      )}
    </>
  );
}
