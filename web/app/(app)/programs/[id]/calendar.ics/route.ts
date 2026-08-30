import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatTarget, type WorkoutTarget } from "@/lib/target";

/** 프로그램 일정 .ics — start_date 기준 일차별 종일 이벤트.
 *
 *  두 가지 접근 경로:
 *  - 로그인 세션(다운로드 버튼): RLS 로 공개/본인 소유만 조회.
 *  - ?token= (캘린더 구독): 구글/애플 서버가 비로그인으로 주기 fetch —
 *    program_calendar() RPC 가 프로그램별 비밀 토큰을 검증한다.
 *  구독 URL 을 등록해 두면 프로그램 수정이 캘린더에 자동 반영된다
 *  (갱신 주기는 캘린더 서비스가 결정 — 구글 12~24시간, 애플 15분~). */

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** YYYY-MM-DD + n일 → ICS DATE(YYYYMMDD) */
function icsDate(startIso: string, addDays: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

type CalItem = {
  /** 구조화 처방 (거리·무게·횟수·세트·시간·메모) — note 만 쓰면 수치가 사라진다 */
  target: WorkoutTarget | null;
  name_ko: string | null;
  name_en: string | null;
};
type CalWorkout = { title: string; items: CalItem[] };
type CalDay = {
  id: string;
  day_index: number;
  focus: string | null;
  notes: string | null;
  workouts: CalWorkout[];
};
type Cal = {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  repeat_enabled: boolean;
  days: CalDay[];
};

function buildIcs(cal: Cal, locale: string): string {
  const exName = (it: CalItem) =>
    (locale === "ko" ? it.name_ko : it.name_en) ?? it.name_ko ?? it.name_en ?? "";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Roxlogy//Training Program//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(cal.title)}`,
    // 구독 클라이언트 갱신 주기 힌트 (지원하는 앱에서만 적용)
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  const stamp = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
  const days = cal.days.slice().sort((a, b) => a.day_index - b.day_index);
  const byIndex = new Map(days.map((d) => [d.day_index, d]));
  const cycleLen = days.reduce((m, d) => Math.max(m, d.day_index), 0);

  // 반복이면 사이클로 전개 — 종료일이 없으면(개인 등록) 오늘+60일까지
  // 굴리며 전개한다(구독 갱신 때마다 창이 앞으로 이동). 비반복은 일차별 1회.
  const repeat = cal.repeat_enabled && cycleLen > 0;
  const horizonEnd = cal.end_date
    ? Date.parse(`${cal.end_date}T00:00:00Z`)
    : Date.now() + 60 * 86400000;
  const totalDays = repeat
    ? Math.min(
        400,
        Math.max(
          cycleLen,
          Math.floor(
            (horizonEnd - Date.parse(`${cal.start_date}T00:00:00Z`)) / 86400000,
          ) + 1,
        ),
      )
    : cycleLen;

  const emit = (d: CalDay, offset: number, occurrence: number) => {
    const date = icsDate(cal.start_date!, offset);
    const next = icsDate(cal.start_date!, offset + 1);
    const summary = [`${cal.title} D${d.day_index}`, d.focus ?? ""]
      .filter(Boolean)
      .join(" · ");
    const desc = d.workouts
      .map((w) => {
        const items = w.items
          .map((it) => {
            const tgt = formatTarget(it.target, locale);
            return `- ${exName(it)}${tgt ? ` (${tgt})` : ""}`;
          })
          .join("\n");
        return items ? `${w.title}\n${items}` : w.title;
      })
      .concat(d.notes ? [d.notes] : [])
      .join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${cal.id}-${d.id}-${occurrence}@roxlogy.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsEscape(summary)}`,
      ...(desc ? [`DESCRIPTION:${icsEscape(desc)}`] : []),
      "END:VEVENT",
    );
  };

  if (repeat) {
    for (let offset = 0; offset < totalDays; offset++) {
      const d = byIndex.get((offset % cycleLen) + 1);
      if (d) emit(d, offset, Math.floor(offset / cycleLen));
    }
  } else {
    for (const d of days) emit(d, d.day_index - 1, 0);
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token");
  const supabase = await createClient();

  let cal: Cal | null = null;
  if (token) {
    // 구독 경로 — 토큰이 자격증명 (비로그인 fetch)
    const { data } = await supabase.rpc("program_calendar", {
      p_id: id,
      p_token: token,
    });
    cal = (data as Cal | null) ?? null;
  } else {
    // 다운로드 경로 — 세션 + RLS. 날짜는 요청자 본인의 활성 등록에서.
    const { data } = await supabase
      .from("programs")
      .select(
        `id, title,
         program_days (
           id, day_index, focus, notes,
           workout_templates (
             title,
             workout_template_items ( seq, target, exercises ( name_ko, name_en ) )
           )
         )`,
      )
      .eq("id", id)
      .maybeSingle();
    // 요청자 본인의 활성 등록 시작일 (own RLS — 남의 일정은 안 보임)
    const { data: myEnroll } = await supabase
      .from("program_enrollments")
      .select("start_date, repeat, end_date")
      .eq("program_id", id)
      .eq("active", true)
      .maybeSingle();
    if (data) {
      type Row = {
        id: string;
        day_index: number;
        focus: string | null;
        notes: string | null;
        workout_templates: {
          title: string;
          workout_template_items: {
            seq: number;
            target: WorkoutTarget | null;
            exercises: { name_ko: string; name_en: string } | null;
          }[];
        }[];
      };
      cal = {
        id: data.id,
        title: data.title,
        start_date: myEnroll?.start_date ?? null,
        end_date: myEnroll?.end_date ?? null,
        repeat_enabled: myEnroll?.repeat === true,
        days: ((data.program_days ?? []) as unknown as Row[]).map((d) => ({
          id: d.id,
          day_index: d.day_index,
          focus: d.focus,
          notes: d.notes,
          workouts: d.workout_templates.map((w) => ({
            title: w.title,
            items: w.workout_template_items
              .slice()
              .sort((a, b) => a.seq - b.seq)
              .map((it) => ({
                target: it.target,
                name_ko: it.exercises?.name_ko ?? null,
                name_en: it.exercises?.name_en ?? null,
              })),
          })),
        })),
      };
    }
  }

  if (!cal) return new Response("not found", { status: 404 });
  if (!cal.start_date) return new Response("no start_date", { status: 400 });

  // 구독 fetch(비로그인)에는 쿠키가 없어 기본 로케일(ko)로 떨어진다
  const { locale } = await getT();

  return new Response(buildIcs(cal, locale), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="roxlogy-program-${cal.id.slice(0, 8)}.ics"`,
    },
  });
}
