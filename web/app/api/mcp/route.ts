import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Roxlogy MCP 서버 — 사용자가 자신의 AI(Claude 등)를 훈련·레이스·크루
 * 데이터에 연결하는 읽기 전용 엔드포인트 (Streamable HTTP).
 *
 * 인증: 설정 페이지에서 발급하는 개인 MCP 토큰(Authorization: Bearer).
 * 데이터 접근은 전부 SECURITY DEFINER RPC(mcp_*)가 토큰을 검증해 그 사용자
 * 스코프로만 반환한다 — 이 서버는 anon 키만 사용하고 어떤 권한도 갖지 않는다.
 */

const supa = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supa().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

const out = (v: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(
        v ?? { error: "not_found_or_invalid_token" },
        null,
        1,
      ),
    },
  ],
});

type Ctx = { http?: { authInfo?: { token?: string } } };
const tok = (ctx: unknown) =>
  (ctx as Ctx).http?.authInfo?.token ?? "";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_profile",
      {
        title: "내 프로필",
        description:
          "Roxlogy 프로필 — 표시 이름, 성별/출생연도, HYROX 공식 기록 연동 상태, 소속 크루 목록(slug 포함). 다른 도구의 crew slug 는 여기서 얻는다.",
        inputSchema: z.object({}),
      },
      async (_a, ctx) => out(await rpc("mcp_profile", { p_token: tok(ctx) })),
    );

    server.registerTool(
      "list_sessions",
      {
        title: "훈련 세션 목록",
        description:
          "최근 훈련 세션 목록 (시작시각, 총 시간 ms, 기록 기기, 디비전, 레이스 연동 여부). limit 최대 50.",
        inputSchema: z.object({
          limit: z.number().int().min(1).max(50).optional(),
        }),
      },
      async ({ limit }, ctx) =>
        out(
          await rpc("mcp_sessions", {
            p_token: tok(ctx),
            p_limit: limit ?? 20,
          }),
        ),
    );

    server.registerTool(
      "get_session",
      {
        title: "세션 상세",
        description:
          "세션 1건의 상세 — 세그먼트(런/스테이션/록스존 순서, 운동명, 구간 시간 ms, 심박) + 페이싱 지표.",
        inputSchema: z.object({ session_id: z.string().uuid() }),
      },
      async ({ session_id }, ctx) =>
        out(
          await rpc("mcp_session", { p_token: tok(ctx), p_id: session_id }),
        ),
    );

    server.registerTool(
      "list_races",
      {
        title: "레이스 기록 목록",
        description:
          "공식 HYROX 레이스 기록 목록 — 대회, 날짜, 디비전, 시즌, 총 시간 ms, 배번(bib), 전체 순위/완주자 수.",
        inputSchema: z.object({}),
      },
      async (_a, ctx) => out(await rpc("mcp_races", { p_token: tok(ctx) })),
    );

    server.registerTool(
      "get_race",
      {
        title: "레이스 상세",
        description:
          "레이스 1건의 전체 스플릿 — splits.stations(스테이션별 ms), runs(런 랩 8개), roxzones, stations_place(스테이션별 필드 순위), field_size, bib.",
        inputSchema: z.object({ race_id: z.string().uuid() }),
      },
      async ({ race_id }, ctx) =>
        out(await rpc("mcp_race", { p_token: tok(ctx), p_id: race_id })),
    );

    server.registerTool(
      "get_stats",
      {
        title: "훈련 통계",
        description:
          "스테이션별 개인 최고기록(PR), 최근 8주 주간 볼륨, 최근 레이스, 목표 계획, 디비전별 필드 벤치마크(실측 p50/p90).",
        inputSchema: z.object({}),
      },
      async (_a, ctx) => out(await rpc("mcp_stats", { p_token: tok(ctx) })),
    );

    server.registerTool(
      "get_today",
      {
        title: "오늘의 훈련·일정",
        description:
          "오늘의 프로그램 일차와 워크아웃, 앞으로 14일의 크루 모임, 30일 내 내 대회 일정.",
        inputSchema: z.object({}),
      },
      async (_a, ctx) => out(await rpc("mcp_today", { p_token: tok(ctx) })),
    );

    server.registerTool(
      "get_crew",
      {
        title: "크루 정보",
        description:
          "slug 없이 호출하면 내 크루 목록, slug 를 주면 그 크루의 소개·위치·운영시간·연락처·운영 정책·멤버 수·내 역할.",
        inputSchema: z.object({ slug: z.string().optional() }),
      },
      async ({ slug }, ctx) =>
        out(
          await rpc("mcp_crew", { p_token: tok(ctx), p_slug: slug ?? null }),
        ),
    );

    server.registerTool(
      "get_crew_schedule",
      {
        title: "크루 일정",
        description:
          "크루의 일정 — 모임(참석 인원 포함), 크루원 대회 참가(결과 기록 포함), 크루 훈련 프로그램. 기본 오늘부터 30일.",
        inputSchema: z.object({
          slug: z.string(),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
      async ({ slug, from, to }, ctx) =>
        out(
          await rpc("mcp_crew_schedule", {
            p_token: tok(ctx),
            p_slug: slug,
            ...(from ? { p_from: from } : {}),
            ...(to ? { p_to: to } : {}),
          }),
        ),
    );

    // ---------- 운영진 전용 (owner/coach 토큰만 — 아니면 null 반환)

    server.registerTool(
      "add_crew_ledger_entry",
      {
        title: "크루 회계 기록 (운영진)",
        description:
          "크루 회계에 수입/지출 내역을 기록한다 (운영진 전용). 영수증 사진을 읽었다면 날짜·금액·상호를 추출해 사용하되, 기록 전 사용자에게 내용을 확인받아라. amount 는 KRW 정수(원).",
        inputSchema: z.object({
          slug: z.string(),
          kind: z.enum(["income", "expense"]),
          amount: z.number().int().positive(),
          title: z.string().min(1).max(120),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          memo: z.string().max(500).optional(),
        }),
      },
      async ({ slug, kind, amount, title, date, memo }, ctx) =>
        out(
          await rpc("mcp_add_ledger", {
            p_token: tok(ctx),
            p_slug: slug,
            p_kind: kind,
            p_amount: amount,
            p_title: title,
            ...(date ? { p_date: date } : {}),
            p_memo: memo ?? null,
          }),
        ),
    );

    server.registerTool(
      "add_crew_meetup",
      {
        title: "크루 모임 등록 (운영진)",
        description:
          "크루 모임 일정을 등록한다 (운영진 전용). starts_at 은 ISO8601 + 타임존 오프셋 (예: 2026-09-01T19:30:00+09:00). kind: wod|race_sim|run|strength|social|race (기본 social). 등록 전 사용자에게 내용을 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          title: z.string().min(1).max(120),
          starts_at: z.string(),
          location: z.string().max(120).optional(),
          description: z.string().max(1000).optional(),
          kind: z
            .enum(["wod", "race_sim", "run", "strength", "social", "race"])
            .optional(),
        }),
      },
      async ({ slug, title, starts_at, location, description, kind }, ctx) =>
        out(
          await rpc("mcp_add_meetup", {
            p_token: tok(ctx),
            p_slug: slug,
            p_title: title,
            p_starts_at: starts_at,
            p_location: location ?? null,
            p_description: description ?? null,
            p_kind: kind ?? "social",
          }),
        ),
    );

    server.registerTool(
      "post_crew_notice",
      {
        title: "크루 공지 작성 (운영진)",
        description:
          "크루 게시판에 공지 글을 올린다 (운영진 전용). pinned=true 면 상단 고정. 게시 전 사용자에게 제목·본문을 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          title: z.string().min(1).max(150),
          body: z.string().min(1).max(8000),
          pinned: z.boolean().optional(),
        }),
      },
      async ({ slug, title, body, pinned }, ctx) =>
        out(
          await rpc("mcp_post_notice", {
            p_token: tok(ctx),
            p_slug: slug,
            p_title: title,
            p_body: body,
            p_pinned: pinned ?? false,
          }),
        ),
    );

    server.registerTool(
      "list_pending_members",
      {
        title: "가입 대기 멤버 (운영진)",
        description:
          "크루 가입 승인을 기다리는 멤버 목록 (운영진 전용) — user_id, 표시 이름, 신청 시각.",
        inputSchema: z.object({ slug: z.string() }),
      },
      async ({ slug }, ctx) =>
        out(
          await rpc("mcp_pending_members", {
            p_token: tok(ctx),
            p_slug: slug,
          }),
        ),
    );

    server.registerTool(
      "approve_crew_member",
      {
        title: "가입 승인 (운영진)",
        description:
          "대기 중인 멤버의 크루 가입을 승인한다 (운영진 전용). user_id 는 list_pending_members 에서 얻는다. 승인 전 사용자에게 누구를 승인할지 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          user_id: z.string().uuid(),
        }),
      },
      async ({ slug, user_id }, ctx) =>
        out(
          await rpc("mcp_approve_member", {
            p_token: tok(ctx),
            p_slug: slug,
            p_user_id: user_id,
          }),
        ),
    );

    server.registerTool(
      "get_crew_finance",
      {
        title: "크루 회계",
        description:
          "크루 회계 (활성 크루원 전용) — 월 수입/지출 합계, 누적 잔액, 해당 월 내역. month 는 YYYY-MM, 기본 이번 달. 금액은 KRW.",
        inputSchema: z.object({
          slug: z.string(),
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        }),
      },
      async ({ slug, month }, ctx) =>
        out(
          await rpc("mcp_crew_finance", {
            p_token: tok(ctx),
            p_slug: slug,
            p_month: month ?? null,
          }),
        ),
    );
  },
  {
    serverInfo: { name: "roxlogy", version: "1.0.0" },
    instructions:
      "Roxlogy 하이록스 훈련 데이터 API. 시간 값은 밀리초(ms). " +
      "크루 도구의 slug 는 get_profile 의 crews 목록에서 얻는다. " +
      "결과가 null 이면 토큰이 잘못됐거나 접근 권한이 없는 것이다. " +
      "쓰기 도구(회계 기록·모임 등록·공지·가입 승인)는 크루 운영진 토큰만 동작하며, " +
      "실행 전 반드시 사용자에게 내용을 확인받는다.",
  },
);

// 토큰 검증은 각 RPC 가 수행 — 여기서는 토큰 존재만 요구해 전달한다.
// (Authorization: Bearer 우선, 헤더를 못 쓰는 클라이언트는 ?token= 허용)
const authed = withMcpAuth(
  handler,
  (req, bearer) => {
    const token =
      bearer ?? new URL(req.url).searchParams.get("token") ?? undefined;
    if (!token || token.length < 24) return undefined;
    return { token, clientId: "roxlogy-mcp", scopes: [] };
  },
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
