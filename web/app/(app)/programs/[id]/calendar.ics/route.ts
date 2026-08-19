import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

/** 프로그램 일정 .ics 내보내기 — start_date 기준 일차별 종일 이벤트.
 *  구글 캘린더(가져오기)·애플 캘린더 등 표준 캘린더 앱에서 바로 불러올 수 있다.
 *  RLS 로 공개/본인 소유 프로그램만 조회되므로 별도 권한 검사는 불필요. */

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

type ItemRow = {
  seq: number;
  target: { note?: string } | null;
  exercises: { name_ko: string; name_en: string } | null;
};
type WorkoutRow = { title: string; type: string; workout_template_items: ItemRow[] };
type DayRow = {
  id: string;
  day_index: number;
  focus: string | null;
  notes: string | null;
  workout_templates: WorkoutRow[];
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { locale } = await getT();

  const { data: program } = await supabase
    .from("programs")
    .select(
      `id, title, start_date,
       program_days (
         id, day_index, focus, notes,
         workout_templates (
           title, type,
           workout_template_items ( seq, target, exercises ( name_ko, name_en ) )
         )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!program) return new Response("not found", { status: 404 });
  if (!program.start_date) return new Response("no start_date", { status: 400 });

  const exName = (ex: { name_ko: string; name_en: string } | null) =>
    ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : "";

  const days = ((program.program_days ?? []) as unknown as DayRow[])
    .slice()
    .sort((a, b) => a.day_index - b.day_index);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Roxlogy//Training Program//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(program.title)}`,
  ];

  const stamp = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
  for (const d of days) {
    const date = icsDate(program.start_date, d.day_index - 1);
    const next = icsDate(program.start_date, d.day_index);
    const summary = [
      `${program.title} D${d.day_index}`,
      d.focus ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    const desc = d.workout_templates
      .map((w) => {
        const items = w.workout_template_items
          .slice()
          .sort((a, b) => a.seq - b.seq)
          .map((it) => {
            const note = it.target?.note ? ` (${it.target.note})` : "";
            return `- ${exName(it.exercises)}${note}`;
          })
          .join("\n");
        return items ? `${w.title}\n${items}` : w.title;
      })
      .concat(d.notes ? [d.notes] : [])
      .join("\n\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${program.id}-${d.id}@roxlogy.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsEscape(summary)}`,
      ...(desc ? [`DESCRIPTION:${icsEscape(desc)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="roxlogy-program-${program.id.slice(0, 8)}.ics"`,
    },
  });
}
