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
      "Roxlogy 하이록스 훈련 데이터 읽기 API. 시간 값은 밀리초(ms). " +
      "크루 도구의 slug 는 get_profile 의 crews 목록에서 얻는다. " +
      "결과가 null 이면 토큰이 잘못됐거나 접근 권한이 없는 것이다.",
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
