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

// ---------------------------------------------------------------- 지표 (analyze.py 이식)
type Seg = {
  id: string;
  kind: string;
  seq: number;
  split_time_ms: number | null;
  erg_samples?: { samples: Record<string, number>[] }[] | { samples: Record<string, number>[] } | null;
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
  for (const seg of segments) {
    const ms = seg.split_time_ms ?? 0;
    const split = fmtMs(seg.split_time_ms);
    if (seg.kind === "run") {
      runN++; runSum += ms; runs.push(ms);
      lines.push(`- 런${runN}: ${split}`);
    } else if (seg.kind === "station") {
      const name = seg.exercises?.name_ko ?? "스테이션";
      stationSum += ms;
      lines.push(`- ${name}: ${split}`);
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

// ---------------------------------------------------------------- 게이트웨이
async function gwSubmit(prompt: string, metadata: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await fetch(`${LLMGW_URL}/v1/generate`, {
      method: "POST",
      headers: GW_HEADERS,
      body: JSON.stringify({ role: AI_ROLE, prompt, system: SYSTEM_PROMPT, wait: 0, metadata }),
    });
    if (!r.ok) { console.error(`gw submit ${r.status}`); return null; }
    const j = await r.json();
    return j.job_id ?? null;
  } catch (e) {
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
      await db.from("ai_jobs").delete().eq("id", jb.id);
      out.collected++;
    } else if (jr.status === "failed") {
      console.error(`gw job failed ${jb.job_id}: ${jr.error}`);
      if (jb.kind === "session") await db.from("sessions").update({ ai_status: "failed" }).eq("id", jb.ref_id);
      if (jb.kind === "race") await db.from("race_results").update({ ai_status: "failed" }).eq("id", jb.ref_id);
      await db.from("ai_jobs").delete().eq("id", jb.id);
      out.failed++;
    }
    // pending → 그대로 둠
  }

  // 제출 중 크래시 잔재(10분 넘게 job_id 없는 클레임) 회수
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await db.from("ai_jobs").delete().is("job_id", null).lt("created_at", cutoff);

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
      .select("id,seq,kind,split_time_ms,exercises(name_ko)")
      .eq("session_id", s.id).order("seq", { ascending: true });
    const segments = (segs ?? []) as unknown as Seg[];
    if (segments.length === 0) {
      await db.from("sessions").update({ ai_status: "skip" }).eq("id", s.id);
      await db.from("ai_jobs").delete().eq("id", claim.id);
      continue;
    }
    const { data: m } = await db.from("session_metrics")
      .select("run_lap_deviation_ms,pacing_grade").eq("session_id", s.id).maybeSingle();
    const { data: goal } = await db.from("goal_plans")
      .select("target_total_ms,run_total_ms,station_total_ms,roxzone_total_ms")
      .eq("user_id", s.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const jobId = await gwSubmit(sessionPrompt(s, segments, m, goal), { kind: "session", ref: s.id });
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

  // ---------- 5) 신규 제출 — 주간 리포트 (지난주 세션 보유 사용자, 멱등)
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
    if (!weekSessions || weekSessions.length === 0) {
      await db.from("ai_jobs").delete().eq("id", claim.id);
      continue;
    }
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
    const jobId = await gwSubmit(lines.join("\n"), { kind: "weekly", ref: `${uid}:${start}` });
    if (!jobId) { await db.from("ai_jobs").delete().eq("id", claim.id); continue; }
    await db.from("ai_jobs").update({ job_id: jobId }).eq("id", claim.id);
    out.submitted++;
  }

  return json({ ok: true, ...out });
});
