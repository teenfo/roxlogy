import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { programDayNumber } from "@/lib/format";
import {
  SessionNewForm,
  type TodayWorkout,
} from "@/components/session-new-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.sessionNew") };
}

type EnrollProgram = {
  start_date: string;
  programs: {
    repeat_enabled: boolean;
    program_days: {
      day_index: number;
      workout_templates: { id: string; title: string }[];
    }[];
  } | null;
};

export default async function SessionNewPage() {
  const supabase = await createClient();

  // 활성 프로그램의 오늘 워크아웃 → 세션에 연결(태깅)할 수 있게 전달
  const { data: enrollment } = await supabase
    .from("program_enrollments")
    .select(
      `start_date,
       programs ( repeat_enabled,
         program_days ( day_index, workout_templates ( id, title ) ) )`,
    )
    .eq("active", true)
    .maybeSingle();

  const enroll = (enrollment ?? null) as unknown as EnrollProgram | null;
  let todayWorkouts: TodayWorkout[] = [];
  if (enroll?.programs) {
    const start = new Date(enroll.start_date + "T00:00:00");
    const nowMid = new Date();
    nowMid.setHours(0, 0, 0, 0);
    const daysSince = Math.floor((nowMid.getTime() - start.getTime()) / 86400000);
    const cycleLen = enroll.programs.program_days.reduce(
      (m, d) => Math.max(m, d.day_index),
      0,
    );
    // 종료 판정: 일차가 프로그램 길이를 넘으면 완료 (반복은 무기한 순환)
    const dayNumber =
      programDayNumber(daysSince, cycleLen, enroll.programs.repeat_enabled) ??
      -1;
    const day = enroll.programs.program_days.find(
      (d) => d.day_index === dayNumber,
    );
    todayWorkouts = (day?.workout_templates ?? []).map((w) => ({
      id: w.id,
      title: w.title,
    }));
  }

  return <SessionNewForm todayWorkouts={todayWorkouts} />;
}
