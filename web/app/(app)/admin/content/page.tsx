import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { AdminExerciseEditor } from "@/components/admin-exercise-editor";
import { AdminProgramActions } from "@/components/admin-program-actions";
import { AdminExerciseRequests, type ExerciseRequest } from "@/components/admin-exercise-requests";
import { QueryFind } from "@/components/rox/query-filters";
import { Empty, Hint, Panel } from "@/components/rox/ui";
import Link from "next/link";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.tabContent") };
}

/** 콘텐츠 관리 — 시안 Admin(content): Panel 운동 콘텐츠[ Find · 목록 ]. 등록 요청·공개 프로그램은 우리 Panel(§4). */
export default async function AdminContentPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const { t, locale } = await getT();

  let exQuery = supabase
    .from("exercises")
    .select("id, name_ko, name_en, muscles, aliases, category, station_type, description_ko, media_url")
    .order(locale === "ko" ? "name_ko" : "name_en")
    .limit(40);
  if (q) exQuery = exQuery.or(`name_ko.ilike.%${q}%,name_en.ilike.%${q}%`);
  const [{ data: exercises }, { data: reqRows }, { data: waitingRaw }, { data: programs }] = await Promise.all([
    exQuery,
    // 운동 등록 요청 (pending) — 관리자 RLS
    supabase.from("exercise_requests").select("id, name_ko, name_en, note, created_at, profiles ( display_name )").eq("status", "pending").order("created_at"),
    // 요청별 대기 항목 수 — 관리자 RPC (RLS 가 남의 비공개 프로그램 항목을 가리므로)
    supabase.rpc("admin_exercise_request_waiting"),
    supabase.from("programs").select("id, title, owner_id").eq("is_public", true).order("created_at", { ascending: false }).limit(50),
  ]);
  const waiting = (waitingRaw ?? {}) as Record<string, { items: number; programs: number }>;
  type ReqRow = {
    id: string;
    name_ko: string;
    name_en: string | null;
    note: string | null;
    created_at: string;
    profiles: { display_name: string | null } | null;
  };
  const requests: ExerciseRequest[] = ((reqRows ?? []) as unknown as ReqRow[]).map((r) => {
    // AI 프로그램 생성(ai_materialize_program, 마이그레이션 089)이 남긴 요청은 메모가
    // 이 접두어로 시작한다 — 접두어 뒤에는 프로그램 제목이 붙는다.
    const m = r.note?.match(/^AI 프로그램 생성에서 자동 요청(?: — (.*))?$/);
    return {
      id: r.id,
      name_ko: r.name_ko,
      name_en: r.name_en,
      note: m ? (m[1]?.trim() || null) : (r.note?.replace(/^MCP 프로그램 등록에서 자동 요청(?: — )?/, "").trim() || null),
      source: m ? ("ai" as const) : r.note?.startsWith("MCP 프로그램 등록에서 자동 요청") ? ("mcp" as const) : ("user" as const),
      waitingItems: waiting[r.id]?.items ?? 0,
      waitingPrograms: waiting[r.id]?.programs ?? 0,
      created_at: r.created_at,
      requester: r.profiles?.display_name ?? "—",
    };
  });

  type Ex = {
    id: string;
    name_ko: string;
    name_en: string;
    muscles: string[] | null;
    aliases: string[] | null;
    category: string | null;
    station_type: string | null;
    description_ko: string | null;
    media_url: string | null;
  };
  const exs = (exercises ?? []) as Ex[];

  return (
    <>
      <Panel title={t("admin.exContent")} action={<span className="rx-muted">{exs.length}</span>}>
        <Hint>{t("admin.exercisesDesc")}</Hint>
        <QueryFind param="q" value={q ?? ""} placeholder={t("exercises.searchPh")} />
        {exs.map((ex) => (
          <AdminExerciseEditor
            key={ex.id}
            id={ex.id}
            name={locale === "ko" ? ex.name_ko : ex.name_en}
            muscles={ex.muscles ?? []}
            aliases={ex.aliases ?? []}
            category={ex.category}
            stationType={ex.station_type}
            description={ex.description_ko}
            mediaUrl={ex.media_url}
          />
        ))}
        {!exs.length && <Empty title={t("admin.noExercises")} description={t("exercises.searchPh")} />}
      </Panel>

      <Panel title={t("admin.exReqTitle")} action={<span className="rx-muted">{requests.length}</span>}>
        <Hint>{t("admin.exReqDesc")}</Hint>
        <AdminExerciseRequests items={requests} />
      </Panel>

      <Panel title={t("admin.publicProgramsTitle")} action={<span className="rx-muted">{programs?.length ?? 0}</span>}>
        {(programs ?? []).map((p) => (
          <div key={p.id} className="rx-record-row" style={{ cursor: "default" }}>
            <span>
              <b>
                <Link href={`/programs/${p.id}`}>{p.title}</Link>
              </b>
            </span>
            <AdminProgramActions programId={p.id} />
          </div>
        ))}
        {!programs?.length && <Empty title={t("admin.noPublicPrograms")} description={t("admin.publicProgramsTitle")} />}
      </Panel>
    </>
  );
}
