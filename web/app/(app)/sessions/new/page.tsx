import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { programDayNumber, todayMidnightIn } from "@/lib/format";
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
  repeat: boolean;
  end_date: string | null;
  programs: {
    program_days: {
      day_index: number;
      workout_templates: { id: string; title: string }[];
    }[];
  } | null;
};

export default async function SessionNewPage() {
  const supabase = await createClient();
  const { tz } = await getT();

  // 활성 프로그램의 오늘 워크아웃 → 세션에 연결(태깅)할 수 있게 전달
  const { data: enrollment } = await supabase
    .from("program_enrollments")
    .select(
      `start_date, repeat, end_date,
       programs (
         program_days ( day_index, workout_templates ( id, title ) ) )`,
    )
    .eq("active", true)
    .maybeSingle();

  const enroll = (enrollment ?? null) as unknown as EnrollProgram | null;
  let todayWorkouts: TodayWorkout[] = [];
  if (enroll?.programs) {
    const start = new Date(enroll.start_date + "T00:00:00");
    // 서버는 UTC — 사용자 시간대(폴백 KST) 기준 오늘로 일차를 계산한다
    const nowMid = todayMidnightIn(tz);
    const daysSince = Math.floor((nowMid.getTime() - start.getTime()) / 86400000);
    const cycleLen = enroll.programs.program_days.reduce(
      (m, d) => Math.max(m, d.day_index),
      0,
    );
    // 종료 판정: 등록 종료일 경과 시 완료 (반복은 종료일까지 순환)
    const pastEnd =
      !!enroll.end_date &&
      nowMid.getTime() > new Date(enroll.end_date + "T00:00:00").getTime();
    const dayNumber = pastEnd
      ? -1
      : (programDayNumber(daysSince, cycleLen, enroll.repeat) ?? -1);
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
