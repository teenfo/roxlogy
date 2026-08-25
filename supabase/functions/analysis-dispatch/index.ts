// analysis-dispatch — 분석 파이프라인 (워커리스: pg_cron 1분마다 호출)
//
// hosub 워커를 제거하고 두 역할을 여기로 이전:
//  1) 파생 지표: analysis_status='pending' 세션 → session_metrics/segment_metrics
//     (worker/analyze.py 수식을 이식 — web/lib/analysis.ts 와 일치, LTTB ≤120pt)
//  2) AI 인사이트: hosub llm-gateway(공개 URL, Bearer 토큰)로 제출·수령.
//     게이트웨이가 잡을 영속화하므로 "wait=0 제출 → 다음 크론에서 수령" 비동기 패턴
//     — Edge 실행시간 제한과 무관하게 32b 장시간 추론도 안전.
//
// 시크릿: LLMGW_URL(예: https://hosub.duckdns.org/llm), LLMGW_TOKEN(커밋 금지),
//         AI_ROLE(선택, 기본 coach_feedback). 미설정이면 지표 계산만 동작.
// 인증: verify_jwt(게이트웨이) — 크론은 anon 키로 호출. 중복 실행 안전:
//   지표는 pending→processing CAS, AI 는 ai_jobs 부분 유니크 클레임.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LLMGW_URL = (Deno.env.get("LLMGW_URL") ?? "").replace(/\/$/, "");
const LLMGW_TOKEN = Deno.env.get("LLMGW_TOKEN") ?? "";
const AI_ROLE = Deno.env.get("AI_ROLE") ?? "coach_feedback";
const AI_ON = LLMGW_URL.length > 0 && LLMGW_TOKEN.length > 0;
const GW_HEADERS = { Authorization: `Bearer ${LLMGW_TOKEN}`, "Content-Type": "application/json" };

const CURVE_MAX_POINTS = 120; // docs/API_CONTRACT.md

const SYSTEM_PROMPT =
  "너는 Roxlogy의 하이록스(HYROX) 트레이닝 코치다. 데이터를 근거로 담백하고 " +
  "정확하게 말한다. 과장·허세·감탄사·이모지 금지. 한국어로 답한다. " +
  "형식: 3~6문장의 분석 + 마지막에 '다음 훈련 제안: '으로 시작하는 실행 가능한 제안 1개. " +
  "마크다운 헤딩 없이 평문으로. 숫자는 주어진 데이터만 사용하고 직접 계산하지 않는다 " +
  "(합계·차이는 이미 계산돼 제공된다).";

// AI 프로그램 생성용 — 엄격 JSON 출력 강제
const PROGRAM_SYSTEM =
  "너는 Roxlogy의 하이록스(HYROX) 트레이닝 프로그램 설계자다. 사용자의 코칭 인사이트" +
  "(약점·페이싱·목표 격차)를 근거로 7일 훈련 프로그램을 설계한다. " +
  "출력은 반드시 아래 스키마의 JSON 하나만 — 설명·마크다운·코드펜스 금지. " +
  '{"title":"...", "description":"...", "level":"beginner|intermediate|advanced|elite", ' +
  '"days":[{"day_index":1, "focus":"...", "title":"...", ' +
  '"items":[{"exercise":"운동이름", "note":"세트·횟수·강도 등 수행 지시"}]}]} ' +
  "규칙: days 는 정확히 7개(day_index 1~7), 주 1~2일은 휴식/회복(items 빈 배열, focus '휴식'), " +
  "훈련일은 items 4~8개. exercise 값은 반드시 제공된 운동 목록의 이름을 그대로 사용. " +
  "note 는 한국어로 구체적으로(예: '4세트 × 12회, 세트간 90초 휴식'). " +
  "인사이트에서 드러난 약점 구간을 우선 보강하고, title/description/focus 는 한국어.";

// ---------------------------------------------------------------- 지표 (analyze.py 이식)
type Seg = {
  id: string;
  kind: string;
  seq: number;
  machine_type?: string | null;
  split_time_ms: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  erg_samples?: { samples: Record<string, number>[] }[] | { samples: Record<string, number>[] } | null;
  segment_metrics?:
    | { avg_power: number | null; avg_spm: number | null; avg_pace_500: number | null }[]
    | { avg_power: number | null; avg_spm: number | null; avg_pace_500: number | null }
    | null;
  exercises?: { name_ko: string } | null;
};

function runLapDeviationMs(segments: Seg[]): number | null {
  const laps = segments
    .filter((s) => s.kind === "run" && s.split_time_ms != null)
    .map((s) => s.split_time_ms as number);
  if (laps.length < 2) return null;
  const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
  const variance = laps.reduce((a, l) => a + (l - mean) ** 2, 0) / laps.length;
  return Math.round(Math.sqrt(variance));
}

function pacingGrade(dev: number): string {
  if (dev < 10_000) return "very_consistent";
  if (dev < 20_000) return "consistent";
  if (dev < 35_000) return "variable";
  return "erratic";
}

function roxzoneTotalMs(segments: Seg[]): number {
  return segments
    .filter((s) => s.kind === "roxzone" && s.split_time_ms != null)
    .reduce((a, s) => a + (s.split_time_ms as number), 0);
}

/** LTTB — Largest Triangle Three Buckets (worker/analyze.py 와 동일 구현) */
function lttb(points: [number, number][], threshold: number): [number, number][] {
  const n = points.length;
  if (threshold >= n || threshold < 3) return points;
  const sampled: [number, number][] = [points[0]];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    let start = Math.floor((i + 1) * bucketSize) + 1;
    let end = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    if (end <= start) end = start + 1;
    const endC = Math.min(end, n);
    let avgX = 0, avgY = 0;
    for (let j = start; j < endC; j++) { avgX += points[j][0]; avgY += points[j][1]; }
    avgX /= endC - start; avgY /= endC - start;

    const curStart = Math.floor(i * bucketSize) + 1;
    const curEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
    const [ax, ay] = points[a];
    let maxArea = -1, chosen = curStart;
    for (let j = curStart; j < curEnd; j++) {
      const [px, py] = points[j];
      const area = Math.abs((ax - avgX) * (py - ay) - (ax - px) * (avgY - ay)) * 0.5;
      if (area > maxArea) { maxArea = area; chosen = j; }
    }
    sampled.push(points[chosen]);
    a = chosen;
  }
  sampled.push(points[n - 1]);
  return sampled;
}

function segmentMetrics(samples: Record<string, number>[]): Record<string, unknown> | null {
  if (!samples || samples.length === 0) return null;
  const nums = (key: string) => samples.filter((s) => s[key] != null).map((s) => Number(s[key]));
  const watts = nums("watts"), spm = nums("spm"), pace = nums("pace");
  const curve = (key: string) => {
    const pts = samples
      .filter((s) => s["t"] != null && s[key] != null)
      .map((s) => [Number(s["t"]), Number(s[key])] as [number, number]);
    if (pts.length < 2) return null;
    return lttb(pts, CURVE_MAX_POINTS).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  };
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    avg_power: watts.length ? Math.round(avg(watts) * 10) / 10 : null,
    max_power: watts.length ? Math.max(...watts) : null,
    avg_spm: spm.length ? Math.round(avg(spm) * 10) / 10 : null,
    avg_pace_500: pace.length ? Math.round(avg(pace) * 100) / 100 : null,
    pace_curve: curve("pace"),
    power_curve: curve("watts"),
  };
}

// ---------------------------------------------------------------- 유틸
function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "-";
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

function weekPeriod(tzName: string | null): { start: string; end: string } {
  let tz = "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tzName ?? "UTC" }); tz = tzName ?? "UTC"; } catch { /* UTC */ }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); // YYYY-MM-DD
  const [y, m, d] = parts.split("-").map(Number);
  const local = new Date(Date.UTC(y, m - 1, d));
  const weekday = (local.getUTCDay() + 6) % 7; // 월=0
  const thisMonday = new Date(local); thisMonday.setUTCDate(local.getUTCDate() - weekday);
  const prevMonday = new Date(thisMonday); prevMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  const end = new Date(prevMonday); end.setUTCDate(prevMonday.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(prevMonday), end: iso(end) };
}

// ---------------------------------------------------------------- 프롬프트 (worker/ai.py 이식)
function sessionPrompt(
  session: { started_at: string; total_time_ms: number | null },
  segments: Seg[],
  metrics: { run_lap_deviation_ms: number | null; pacing_grade: string | null } | null,
  goal: Record<string, number | null> | null,
): string {
  const lines = [
    "다음 하이록스 시뮬 세션을 분석해 코칭 코멘트를 작성하라.",
    `세션 일시: ${(session.started_at ?? "").slice(0, 16)}`,
    `총 시간: ${fmtMs(session.total_time_ms)}`,
    "",
    "구간 기록:",
  ];
  let runN = 0, runSum = 0, stationSum = 0, roxSum = 0;
  const runs: number[] = [];
  const hr = (g: Seg) => g.avg_hr != null ? ` (심박 평균 ${g.avg_hr}${g.max_hr != null ? `·최대 ${g.max_hr}` : ""})` : "";
  for (const seg of segments) {
    const ms = seg.split_time_ms ?? 0;
    const split = fmtMs(seg.split_time_ms);
    if (seg.kind === "run") {
      runN++; runSum += ms; runs.push(ms);
      lines.push(`- 런${runN}: ${split}${hr(seg)}`);
    } else if (seg.kind === "station") {
      const name = seg.exercises?.name_ko ?? "스테이션";
      stationSum += ms;
      lines.push(`- ${name}: ${split}${hr(seg)}`);
    } else if (seg.kind === "roxzone") {
      roxSum += ms;
      lines.push(`- 록스존: ${split}`);
    }
  }
  lines.push("", `합계(계산됨): 런 ${fmtMs(runSum)}, 스테이션 ${fmtMs(stationSum)}, 록스존 ${fmtMs(roxSum)}`);
  if (runs.length) {
    const fastest = Math.min(...runs), slowest = Math.max(...runs);
    lines.push(`런 최속 ${fmtMs(fastest)}(런${runs.indexOf(fastest) + 1}) / 최저 ${fmtMs(slowest)}(런${runs.indexOf(slowest) + 1})`);
  }
  if (metrics) {
    lines.push(`런 랩 편차: ${fmtMs(metrics.run_lap_deviation_ms)} (페이싱 등급: ${metrics.pacing_grade ?? "-"})`);
  }
  if (goal) {
    lines.push("", "목표(사용자 설정) 대비 — 격차(계산됨, +는 목표보다 느림):");
    const rows: [string, number | null, number | null][] = [
      ["총시간", goal.target_total_ms ?? null, session.total_time_ms],
      ["런 합계", goal.run_total_ms ?? null, runSum],
      ["스테이션 합계", goal.station_total_ms ?? null, stationSum],
      ["록스존", goal.roxzone_total_ms ?? null, roxSum],
    ];
    for (const [label, g, actual] of rows) {
      if (g != null && actual != null) {
        lines.push(`- ${label}: 목표 ${fmtMs(g)} / 실제 ${fmtMs(actual)} / 격차 ${fmtMs(actual - g)}`);
      }
    }
  }
  return lines.join("\n");
}

// 에르그 단독 세션(머신 스테이션만) 전용 프롬프트 — 시뮬 관점(런·록스존·페이싱 등급)
// 대신 페이스 유지·스트로크 효율·케이던스 관점으로 코칭한다.
function ergSessionPrompt(
  session: { started_at: string; total_time_ms: number | null },
  machine: string,
  metrics: { avg_power: number | null; avg_spm: number | null; avg_pace_500: number | null } | null,
  samples: Record<string, number | null>[],
  strokes: Record<string, number | null>[],
): string {
  const name = machine === "row" ? "로잉(RowErg)" : "스키에르그(SkiErg)";
  const dists = samples.map((s) => s.dist).filter((x): x is number => typeof x === "number");
  const dist = dists.length ? Math.max(...dists) : null;
  const watts = samples.map((s) => s.watts).filter((w): w is number => typeof w === "number" && w > 0);
  const third = Math.max(1, Math.floor(watts.length / 3));
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const w1 = avg(watts.slice(0, third));
  const w2 = avg(watts.slice(third, third * 2));
  const w3 = avg(watts.slice(third * 2));
  const num = (k: string) => {
    const v = strokes.map((s) => s[k]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const driveLen = num("drive_len"), strokeDist = num("stroke_dist");
  const driveMs = num("drive_ms"), recoverMs = num("recover_ms"), peak = num("peak_force");
  const lines = [
    `다음 에르그 단독 세션(${name})을 분석해 코칭 코멘트를 작성하라.`,
    "관점: 페이스 유지(전·중·후반 파워 변화), 스트로크 효율(드라이브 길이·스트로크당 거리·" +
      "드라이브:리커버리 비율), 케이던스(spm) 선택. 마지막 '다음 훈련 제안'은 하이록스 " +
      "레이스에서 이 머신 구간 공략과 연결하라. 런·록스존 언급은 하지 마라(이 세션에는 없다).",
    `세션 일시: ${(session.started_at ?? "").slice(0, 16)}`,
    `시간: ${fmtMs(session.total_time_ms)}` + (dist != null ? `, 거리(계산됨): ${Math.round(dist)}m` : ""),
  ];
  if (metrics) {
    const p = metrics.avg_power != null ? `${Math.round(Number(metrics.avg_power))}W` : "-";
    const pc = metrics.avg_pace_500 != null ? `${fmtMs(Number(metrics.avg_pace_500) * 1000)}/500m` : "-";
    const spm = metrics.avg_spm != null ? `${Math.round(Number(metrics.avg_spm))}spm` : "-";
    lines.push(`평균 파워 ${p} · 평균 페이스 ${pc} · 평균 ${spm}`);
  }
  if (w1 != null && w3 != null) {
    lines.push(`전·중·후반 평균 파워(계산됨): ${w1}W / ${w2 ?? "-"}W / ${w3}W`);
  }
  if (strokes.length) {
    const parts = [`스트로크 ${strokes.length}개`];
    if (driveLen != null) parts.push(`평균 드라이브 길이 ${driveLen.toFixed(2)}m`);
    if (strokeDist != null) parts.push(`스트로크당 거리 ${strokeDist.toFixed(2)}m`);
    if (driveMs != null && recoverMs != null && driveMs > 0) {
      parts.push(`드라이브:리커버리 1:${(recoverMs / driveMs).toFixed(2)}`);
    }
    if (peak != null) parts.push(`평균 최대힘 ${Math.round(peak)}lbs`);
    lines.push(`스트로크 지표(계산됨): ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- 게이트웨이
// 마지막 제출 실패 사유 — 응답 진단용 (민감정보 없음: 상태코드/에러 클래스만)
let lastGwError: string | null = null;

async function gwSubmit(
  prompt: string,
  metadata: Record<string, unknown>,
  system: string = SYSTEM_PROMPT,
): Promise<string | null> {
  try {
    const r = await fetch(`${LLMGW_URL}/v1/generate`, {
      method: "POST",
      headers: GW_HEADERS,
      body: JSON.stringify({ role: AI_ROLE, prompt, system, wait: 0, metadata }),
    });
    if (!r.ok) {
      const bodyHead = (await r.text().catch(() => "")).slice(0, 120);
      lastGwError = `HTTP ${r.status}: ${bodyHead}`;
      console.error(`gw submit ${lastGwError}`);
      return null;
    }
    const j = await r.json();
    lastGwError = j.job_id ? null : `no job_id in response`;
    return j.job_id ?? null;
  } catch (e) {
    lastGwError = `fetch: ${String(e).slice(0, 160)}`;
    console.error("gw submit error:", e);
    return null;
  }
}

async function gwPoll(jobId: string): Promise<{ status: string; response?: string; error?: string } | null> {
  try {
    const r = await fetch(`${LLMGW_URL}/v1/jobs/${jobId}`, { headers: GW_HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 알림
// deno-lint-ignore no-explicit-any
async function notify(db: any, userId: string, typeKey: string, title: string, body: string, url: string) {
  // enqueue_notification(옵트아웃 존중) → push-dispatch 크론이 발송
  await db.rpc("enqueue_notification", {
    p_user_id: userId, p_type_key: typeKey, p_title: title, p_body: body, p_url: url,
  });
}

/** 인사이트 종류별 완료 알림 문구·이동 경로 */
function insightNotice(kind: string, refId: string | null): [string, string, string] {
  if (kind === "session")
    return ["AI 코칭 코멘트 등록", "세션 분석 코멘트가 준비됐습니다.", `/sessions/${refId}`];
  if (kind === "race")
    return ["AI 레이스 리포트 등록", "레이스 분석 리포트가 준비됐습니다.", `/races/${refId}`];
  return ["AI 주간 리포트 등록", "지난주 훈련 리포트가 준비됐습니다.", "/dashboard"];
}

/** 32b 가 출력한 프로그램 JSON 을 programs/일자/워크아웃/아이템으로 생성. 성공 시 program id. */
// deno-lint-ignore no-explicit-any
async function materializeProgram(db: any, userId: string, raw: string): Promise<string | null> {
  // 코드펜스·앞뒤 잡문 방어: 첫 '{' ~ 마지막 '}' 만 취함
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  let plan: {
    title?: string; description?: string; level?: string;
    days?: { day_index?: number; focus?: string; title?: string;
      items?: { exercise?: string; note?: string }[] }[];
  };
  try { plan = JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
  if (!plan.title || !Array.isArray(plan.days) || plan.days.length === 0) return null;

  // 운동 이름 → id 매핑 (미매칭은 exercise_id null + note 에 이름 보존)
  const { data: exs } = await db.from("exercises").select("id,name_ko");
  const exMap = new Map<string, string>((exs ?? []).map((x: { id: string; name_ko: string }) => [x.name_ko, x.id]));

  const level = ["beginner", "intermediate", "advanced", "elite"].includes(plan.level ?? "")
    ? plan.level : null;
  const { data: prog, error: progErr } = await db.from("programs").insert({
    owner_id: userId,
    title: String(plan.title).slice(0, 80),
    description: `${String(plan.description ?? "").slice(0, 500)}\n\n(AI 생성 — 최근 코칭 인사이트 기반)`.trim(),
    weeks: 1, level, is_public: false,
  }).select("id").single();
  if (progErr || !prog) return null;

  for (const day of plan.days.slice(0, 7)) {
    const idx = Number(day.day_index);
    if (!Number.isInteger(idx) || idx < 1 || idx > 7) continue;
    const { data: d } = await db.from("program_days").insert({
      program_id: prog.id, day_index: idx, focus: day.focus?.slice(0, 60) ?? null,
    }).select("id").single();
    if (!d) continue;
    const items = Array.isArray(day.items) ? day.items.slice(0, 10) : [];
    if (items.length === 0) continue; // 휴식일
    const { data: tmpl } = await db.from("workout_templates").insert({
      program_day_id: d.id,
      title: day.title?.slice(0, 80) || day.focus?.slice(0, 80) || `Day ${idx}`,
      type: "wod", structure: {},
    }).select("id").single();
    if (!tmpl) continue;
    const rows = items.map((it, i) => {
      const exId = it.exercise ? exMap.get(it.exercise) ?? null : null;
      const note = [exId ? null : it.exercise, it.note].filter(Boolean).join(" — ").slice(0, 300);
      return { template_id: tmpl.id, seq: i + 1, exercise_id: exId, target: note ? { note } : null };
    });
    if (rows.length) await db.from("workout_template_items").insert(rows);
  }
  return prog.id;
}

// ---------------------------------------------------------------- 메인
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const db = createClient(URL_, SERVICE);
  const out = { metrics: 0, submitted: 0, collected: 0, failed: 0 };

  // ---------- 1) 파생 지표 (pending → processing CAS → 계산 → done)
  const { data: pend } = await db.from("sessions")
    .select("id").eq("analysis_status", "pending").is("deleted_at", null)
    .order("started_at", { ascending: true }).limit(5);
  for (const s of pend ?? []) {
    const { data: claimed } = await db.from("sessions")
      .update({ analysis_status: "processing" })
      .eq("id", s.id).eq("analysis_status", "pending").select("id");
    if (!claimed || claimed.length === 0) continue;
    try {
      const { data: segs } = await db.from("session_segments")
        .select("id,seq,kind,split_time_ms,erg_samples(samples)")
        .eq("session_id", s.id).order("seq", { ascending: true });
      const segments = (segs ?? []) as unknown as Seg[];
      const dev = runLapDeviationMs(segments);
      await db.from("session_metrics").upsert({
        session_id: s.id,
        run_lap_deviation_ms: dev,
        roxzone_total_ms: roxzoneTotalMs(segments),
        pacing_grade: dev != null ? pacingGrade(dev) : null,
      }, { onConflict: "session_id" });
      for (const seg of segments) {
        const erg = seg.erg_samples;
        const raw = Array.isArray(erg) ? erg[0]?.samples : erg?.samples;
        if (!raw) continue;
        const gm = segmentMetrics(raw);
        if (!gm) continue;
        await db.from("segment_metrics").upsert({ segment_id: seg.id, ...gm }, { onConflict: "segment_id" });
      }
      await db.from("sessions").update({ analysis_status: "done" }).eq("id", s.id);
      out.metrics++;
    } catch (e) {
      console.error(`metrics failed ${s.id}:`, e);
      await db.from("sessions").update({ analysis_status: "failed" }).eq("id", s.id);
    }
  }

  if (!AI_ON) {
    // 진단: 어떤 이름의 env 가 보이는지 (이름만 — 값은 절대 노출하지 않음)
    const envNames = Object.keys(Deno.env.toObject()).filter(
      (k) => k.includes("LLM") || k.includes("GW") || k === "AI_ROLE",
    );
    return json({ ok: true, ...out, ai: "disabled(no LLMGW secrets)", env_seen: envNames });
  }

  // ---------- 2) 제출된 잡 수령
  const { data: jobs } = await db.from("ai_jobs")
    .select("id,kind,user_id,ref_id,period_start,job_id").not("job_id", "is", null).limit(20);
  for (const jb of jobs ?? []) {
    const jr = await gwPoll(jb.job_id!);
    if (!jr) continue; // 게이트웨이 일시 불가 — 다음 크론에
    if (jr.status === "ok" && jr.response) {
      if (jb.kind === "program") {
        // 프로그램 JSON → 실체화 + 완료/실패 알림
        const progId = await materializeProgram(db, jb.user_id, jr.response);
        if (progId) {
          await notify(db, jb.user_id, "ai_program", "AI 훈련 프로그램 도착",
            "코칭 인사이트 기반 7일 프로그램이 준비됐습니다.", `/programs/${progId}`);
        } else {
          console.error(`program materialize 실패 ${jb.job_id}`);
          await notify(db, jb.user_id, "ai_program", "AI 프로그램 생성 실패",
            "프로그램 생성에 실패했습니다. 다시 시도해 주세요.", "/programs");
        }
        await db.from("ai_jobs").delete().eq("id", jb.id);
        out.collected++;
        continue;
      }
      // delete + insert 재생성 (부분 유니크 인덱스라 upsert 불가)
      let del = db.from("ai_insights").delete().eq("user_id", jb.user_id).eq("kind", jb.kind);
      if (jb.ref_id) del = del.eq("ref_id", jb.ref_id);
      if (jb.period_start) del = del.eq("period_start", jb.period_start);
      await del;
      await db.from("ai_insights").insert({
        user_id: jb.user_id, kind: jb.kind, content: jr.response.trim(),
        model: `llmgw/${AI_ROLE}`, ref_id: jb.ref_id, period_start: jb.period_start,
      });
      if (jb.kind === "session") await db.from("sessions").update({ ai_status: "done" }).eq("id", jb.ref_id);
      if (jb.kind === "race") await db.from("race_results").update({ ai_status: "done" }).eq("id", jb.ref_id);
      // 인사이트 등록 완료 알림 (옵트아웃은 enqueue_notification 이 처리)
      const [nTitle, nBody, nUrl] = insightNotice(jb.kind, jb.ref_id);
      await notify(db, jb.user_id, "ai_insight", nTitle, nBody, nUrl);
      await db.from("ai_jobs").delete().eq("id", jb.id);
      out.collected++;
    } else if (jr.status === "failed") {
      console.error(`gw job failed ${jb.job_id}: ${jr.error}`);
      if (jb.kind === "session") await db.from("sessions").update({ ai_status: "failed" }).eq("id", jb.ref_id);
      if (jb.kind === "race") await db.from("race_results").update({ ai_status: "failed" }).eq("id", jb.ref_id);
      if (jb.kind === "program") {
        await notify(db, jb.user_id, "ai_program", "AI 프로그램 생성 실패",
          "프로그램 생성에 실패했습니다. 다시 시도해 주세요.", "/programs");
      }
      await db.from("ai_jobs").delete().eq("id", jb.id);
      out.failed++;
    }
    // pending → 그대로 둠
  }

  // 제출 중 크래시 잔재(10분 넘게 job_id 없는 클레임) 회수.
  // program 은 사용자 요청 큐라 제외 — 게이트웨이가 오래 죽어 있어도 요청이 사라지면 안 됨.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await db.from("ai_jobs").delete().is("job_id", null).lt("created_at", cutoff).neq("kind", "program");

  // ---------- 2.5) AI 프로그램 요청 제출 (사용자 버튼 → ai-program-request 가 큐잉)
  const { data: progReqs } = await db.from("ai_jobs")
    .select("id,user_id").eq("kind", "program").is("job_id", null).limit(2);
  for (const pr of progReqs ?? []) {
    // 최근 코칭 인사이트(최신 3건) — 약점·격차의 근거
    const { data: insights } = await db.from("ai_insights")
      .select("kind,content").eq("user_id", pr.user_id)
      .neq("kind", "program").order("created_at", { ascending: false }).limit(3);
    const { data: goal } = await db.from("goal_plans")
      .select("target_total_ms,run_total_ms,station_total_ms,roxzone_total_ms")
      .eq("user_id", pr.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    // 허용 운동 목록: 하이록스 스테이션 전부 + 보조 카테고리 (이름 그대로 매칭)
    const { data: exs } = await db.from("exercises")
      .select("name_ko,station_type,category")
      .or("station_type.not.is.null,category.in.(running,conditioning,strength)")
      .limit(140);
    const exNames = (exs ?? []).map((x: { name_ko: string }) => x.name_ko);

    const lines = [
      "아래 정보를 바탕으로 이 사용자를 위한 7일 하이록스 훈련 프로그램 JSON 을 작성하라.",
      "",
      "## 최근 코칭 인사이트",
      ...(insights?.length
        ? insights.map((i: { kind: string; content: string }) => `[${i.kind}] ${i.content.slice(0, 500)}`)
        : ["(인사이트 없음 — 균형 잡힌 입문 프로그램을 작성)"]),
    ];
    if (goal) {
      lines.push("", "## 목표", `총시간 ${fmtMs(goal.target_total_ms)}, 런 합계 ${fmtMs(goal.run_total_ms)}, 스테이션 합계 ${fmtMs(goal.station_total_ms)}, 록스존 ${fmtMs(goal.roxzone_total_ms)}`);
    }
    lines.push("", "## 사용 가능한 운동 목록 (exercise 값은 이 중에서 그대로)", exNames.join(", "));

    const jobId = await gwSubmit(lines.join("\n"), { kind: "program", ref: pr.user_id }, PROGRAM_SYSTEM);
    if (!jobId) continue; // 게이트웨이 불가 — 요청은 큐에 유지, 다음 크론 재시도
    await db.from("ai_jobs").update({ job_id: jobId }).eq("id", pr.id);
    out.submitted++;
  }

  // ---------- 3) 신규 제출 — 세션
  const { data: sess } = await db.from("sessions")
    .select("id,user_id,started_at,total_time_ms")
    .eq("ai_status", "pending").eq("analysis_status", "done").is("deleted_at", null)
    .order("started_at", { ascending: false }).limit(3);
  for (const s of sess ?? []) {
    // 클레임 (부분 유니크 kind+ref_id — 중복이면 23505 로 스킵)
    const { data: claim, error: claimErr } = await db.from("ai_jobs")
      .insert({ kind: "session", user_id: s.user_id, ref_id: s.id }).select("id").single();
    if (claimErr || !claim) continue;
    const { data: segs } = await db.from("session_segments")
      .select("id,seq,kind,machine_type,split_time_ms,avg_hr,max_hr,exercises(name_ko),segment_metrics(avg_power,avg_spm,avg_pace_500)")
      .eq("session_id", s.id).order("seq", { ascending: true });
    const segments = (segs ?? []) as unknown as Seg[];
    if (segments.length === 0) {
      await db.from("sessions").update({ ai_status: "skip" }).eq("id", s.id);
      await db.from("ai_jobs").delete().eq("id", claim.id);
      continue;
    }
    // 에르그 단독 세션(머신 스테이션만) → 전용 프롬프트, 그 외 → 시뮬 프롬프트
    const isErg = segments.every((g) => g.kind === "station") && segments.some((g) => g.machine_type);
    let prompt: string;
    if (isErg) {
      const mseg = segments.find((g) => g.machine_type)!;
      const { data: raw } = await db.from("erg_samples")
        .select("samples,strokes").eq("segment_id", mseg.id).maybeSingle();
      const sm = Array.isArray(mseg.segment_metrics) ? mseg.segment_metrics[0] : mseg.segment_metrics;
      prompt = ergSessionPrompt(
        s,
        mseg.machine_type!,
        sm ?? null,
        ((raw?.samples ?? []) as Record<string, number | null>[]).slice(0, 3600),
        ((raw?.strokes ?? []) as Record<string, number | null>[]).slice(0, 2000),
      );
    } else {
      const { data: m } = await db.from("session_metrics")
        .select("run_lap_deviation_ms,pacing_grade").eq("session_id", s.id).maybeSingle();
      const { data: goal } = await db.from("goal_plans")
        .select("target_total_ms,run_total_ms,station_total_ms,roxzone_total_ms")
        .eq("user_id", s.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      prompt = sessionPrompt(s, segments, m, goal);
    }
    const jobId = await gwSubmit(prompt, { kind: "session", ref: s.id });
    if (!jobId) { await db.from("ai_jobs").delete().eq("id", claim.id); continue; }
    await db.from("ai_jobs").update({ job_id: jobId }).eq("id", claim.id);
    out.submitted++;
  }

  // ---------- 4) 신규 제출 — 레이스
  const { data: races } = await db.from("race_results")
    .select("id,user_id,event,event_date,division,total_time_ms,splits")
    .eq("ai_status", "pending").order("created_at", { ascending: false }).limit(3);
  for (const race of races ?? []) {
    if (!race.splits && !race.total_time_ms) {
      await db.from("race_results").update({ ai_status: "skip" }).eq("id", race.id);
      continue;
    }
    const { data: claim, error: claimErr } = await db.from("ai_jobs")
      .insert({ kind: "race", user_id: race.user_id, ref_id: race.id }).select("id").single();
    if (claimErr || !claim) continue;
    const prompt = [
      "다음 하이록스 레이스 결과를 분석해 코멘트를 작성하라 (강점 구간·약점 구간·록스존/전환 손실 중심).",
      `대회: ${race.event ?? "-"} (${race.event_date ?? "-"}), 디비전: ${race.division ?? "-"}`,
      `총 시간: ${fmtMs(race.total_time_ms)}`,
      `스플릿 데이터(JSON, ms 단위): ${JSON.stringify(race.splits).slice(0, 3000)}`,
    ].join("\n");
    const jobId = await gwSubmit(prompt, { kind: "race", ref: race.id });
    if (!jobId) { await db.from("ai_jobs").delete().eq("id", claim.id); continue; }
    await db.from("ai_jobs").update({ job_id: jobId }).eq("id", claim.id);
    out.submitted++;
  }

  // ---------- 5) 신규 제출 — 주간 리포트 (최근 14일 활동 사용자, 휴식 주 포함, 멱등)
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data: recent } = await db.from("sessions")
    .select("user_id").is("deleted_at", null).gte("started_at", since).limit(1000);
  const userIds = [...new Set((recent ?? []).map((r) => r.user_id))].slice(0, 20);
  for (const uid of userIds) {
    const { data: prof } = await db.from("profiles").select("timezone").eq("id", uid).maybeSingle();
    const { start, end } = weekPeriod(prof?.timezone ?? null);
    const { data: exists } = await db.from("ai_insights")
      .select("id").eq("user_id", uid).eq("kind", "weekly").eq("period_start", start).limit(1);
    if (exists && exists.length > 0) continue;
    const { data: claim, error: claimErr } = await db.from("ai_jobs")
      .insert({ kind: "weekly", user_id: uid, period_start: start }).select("id").single();
    if (claimErr || !claim) continue;
    const { data: weekSessions } = await db.from("sessions")
      .select("id,started_at,total_time_ms,session_metrics(run_lap_deviation_ms,pacing_grade)")
      .eq("user_id", uid).is("deleted_at", null)
      .gte("started_at", `${start}T00:00:00Z`).lte("started_at", `${end}T23:59:59Z`)
      .order("started_at", { ascending: true }).limit(50);
    let prompt: string;
    if (!weekSessions || weekSessions.length === 0) {
      // 휴식 주 — 직전 4주 이력을 컨텍스트로 회복/재개 코멘트를 생성한다.
      // (최근 14일 활동 게이트가 있어 완전 이탈 사용자에겐 무한 생성되지 않음)
      const histStart = new Date(
        new Date(`${start}T00:00:00Z`).getTime() - 28 * 24 * 3600 * 1000,
      ).toISOString().slice(0, 10);
      const { data: hist } = await db.from("sessions")
        .select("started_at,total_time_ms")
        .eq("user_id", uid).is("deleted_at", null)
        .gte("started_at", `${histStart}T00:00:00Z`)
        .lte("started_at", `${end}T23:59:59Z`)
        .order("started_at", { ascending: true }).limit(100);
      if (!hist || hist.length === 0) {
        await db.from("ai_jobs").delete().eq("id", claim.id);
        continue;
      }
      prompt = [
        `사용자가 지난주(${start} ~ ${end}) 하이록스 훈련을 쉬었다. ` +
        "휴식 주간 리포트를 작성하라 (휴식·회복의 의미, 직전 훈련 흐름 한 줄 요약, " +
        "재개 시 권장 강도와 첫 세션 제안 중심. 과장 없이 담백하게, 3~4문장).",
        "직전 4주 세션 이력:",
        ...hist.map((s) => `- ${s.started_at.slice(0, 10)}: 총 ${fmtMs(s.total_time_ms)}`),
      ].join("\n");
    } else {
      const totals = weekSessions.map((s) => s.total_time_ms).filter((x): x is number => x != null);
      const lines = [
        `다음은 한 사용자의 지난주(${start} ~ ${end}) 하이록스 훈련 세션 목록이다. ` +
        "주간 훈련 리포트를 작성하라 (세션 수·페이스 추세·일관성 중심).",
        `세션 수(계산됨): ${weekSessions.length}` +
        (totals.length ? `, 최고 기록(계산됨): ${fmtMs(Math.min(...totals))}` : ""),
        "",
      ];
      for (const s of weekSessions) {
        const mm = Array.isArray(s.session_metrics) ? s.session_metrics[0] : s.session_metrics;
        lines.push(
          `- ${s.started_at.slice(0, 10)}: 총 ${fmtMs(s.total_time_ms)}, ` +
          `런 편차 ${fmtMs(mm?.run_lap_deviation_ms)}, 등급 ${mm?.pacing_grade ?? "-"}`,
        );
      }
      prompt = lines.join("\n");
    }
    const jobId = await gwSubmit(prompt, { kind: "weekly", ref: `${uid}:${start}` });
    if (!jobId) { await db.from("ai_jobs").delete().eq("id", claim.id); continue; }
    await db.from("ai_jobs").update({ job_id: jobId }).eq("id", claim.id);
    out.submitted++;
  }

  return json({ ok: true, ...out, ...(lastGwError ? { gw_error: lastGwError } : {}) });
});
