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
          "크루 모임 일정을 등록한다 (운영진 전용). starts_at 은 ISO8601 + 타임존 오프셋 (예: 2026-09-01T19:30:00+09:00). kind: wod|race_sim|run|strength|social|race (기본 social). capacity(정원)를 주면 초과 참석 신청은 자동으로 대기열에 들어가고, 공석이 생기면 순서대로 자동 참석된다. 등록 전 사용자에게 내용을 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          title: z.string().min(1).max(120),
          starts_at: z.string(),
          location: z.string().max(120).optional(),
          description: z.string().max(1000).optional(),
          kind: z
            .enum(["wod", "race_sim", "run", "strength", "social", "race"])
            .optional(),
          capacity: z.number().int().min(1).optional(),
        }),
      },
      async ({ slug, title, starts_at, location, description, kind, capacity }, ctx) =>
        out(
          await rpc("mcp_add_meetup", {
            p_token: tok(ctx),
            p_slug: slug,
            p_title: title,
            p_starts_at: starts_at,
            p_location: location ?? null,
            p_description: description ?? null,
            p_kind: kind ?? "social",
            p_capacity: capacity ?? null,
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

    // ---------- 훈련 프로그램

    server.registerTool(
      "list_exercises",
      {
        title: "운동 DB 목록",
        description:
          "Roxlogy 운동 DB — 프로그램 워크아웃 아이템에 쓸 수 있는 운동 목록(name_ko/name_en, 스테이션 타입). 워크아웃을 만들기 전에 먼저 조회해서 이 목록의 이름만 사용하라.",
        inputSchema: z.object({}),
      },
      async (_a, ctx) =>
        out(await rpc("mcp_exercises", { p_token: tok(ctx) })),
    );

    server.registerTool(
      "request_exercise",
      {
        title: "운동 등록 요청",
        description:
          "운동 DB 에 없는 운동의 등록을 요청한다 (관리자 승인 후 추가됨 — 승인 전에는 워크아웃에 쓸 수 없다). 이미 있는 운동이면 already_exists 로 알려준다. 요청 전 사용자에게 운동명을 확인받아라.",
        inputSchema: z.object({
          name_ko: z.string().min(1).max(60),
          name_en: z.string().max(60).optional(),
          note: z.string().max(300).optional(),
        }),
      },
      async ({ name_ko, name_en, note }, ctx) =>
        out(
          await rpc("mcp_request_exercise", {
            p_token: tok(ctx),
            p_name_ko: name_ko,
            p_name_en: name_en ?? null,
            p_note: note ?? null,
          }),
        ),
    );

    server.registerTool(
      "list_my_programs",
      {
        title: "내 훈련 프로그램 목록",
        description:
          "내가 만든 훈련 프로그램 목록 — 제목, 주수, 레벨, 시작일, 일차 수, 연결된 크루 slug.",
        inputSchema: z.object({}),
      },
      async (_a, ctx) =>
        out(await rpc("mcp_my_programs", { p_token: tok(ctx) })),
    );

    server.registerTool(
      "get_program",
      {
        title: "프로그램 상세",
        description:
          "훈련 프로그램 1건의 상세 — 일차별(day_index) 포커스와 내용. 내 프로그램, 공개 프로그램, 내 크루에 연결된 프로그램을 볼 수 있다.",
        inputSchema: z.object({ program_id: z.string().uuid() }),
      },
      async ({ program_id }, ctx) =>
        out(await rpc("mcp_program", { p_token: tok(ctx), p_id: program_id })),
    );

    server.registerTool(
      "create_program",
      {
        title: "훈련 프로그램 생성",
        description:
          "훈련 프로그램(템플릿)을 일차 계획과 함께 한 번에 생성한다. days 는 [{day_index(1부터, 주수×7 이내), focus(한 줄 요약), notes(상세 와드), workouts?}] 배열. " +
          "workouts 아이템의 exercise 는 운동 DB(list_exercises)에 등록된 이름(한/영)만 허용 — 미등록 이름이 있으면 unknown_exercises 로 전체 거부되니 먼저 list_exercises 로 확인하고, 없는 운동은 request_exercise 로 등록을 요청하라. " +
          "프로그램은 날짜 없는 템플릿이다 — 시작일은 개인이 웹에서 시작하거나 attach_crew_program 으로 크루에 연결할 때 정한다. 생성 전 사용자에게 구성을 확인받아라.",
        inputSchema: z.object({
          title: z.string().min(1).max(120),
          weeks: z.number().int().min(1).max(20),
          days: z
            .array(
              z.object({
                day_index: z.number().int().min(1),
                focus: z.string().max(200).optional(),
                notes: z.string().max(2000).optional(),
          workouts: z
            .array(
              z.object({
                title: z.string().max(80).optional(),
                type: z
                  .enum(["race_sim", "wod", "run", "strength"])
                  .optional(),
                items: z
                  .array(
                    z.object({
                      exercise: z.string().min(1).max(80),
                      note: z.string().max(80).optional(),
                    }),
                  )
                  .min(1)
                  .max(15),
              }),
            )
            .max(5)
            .optional(),
              }),
            )
            .min(1)
            .max(140),
          level: z
            .enum(["beginner", "intermediate", "advanced", "elite"])
            .optional(),
          description: z.string().max(2000).optional(),
        }),
      },
      async ({ title, weeks, days, level, description }, ctx) =>
        out(
          await rpc("mcp_create_program", {
            p_token: tok(ctx),
            p_title: title,
            p_weeks: weeks,
            p_days: days,
            p_level: level ?? "intermediate",
            p_description: description ?? null,
          }),
        ),
    );

    server.registerTool(
      "set_program_day",
      {
        title: "프로그램 일차 수정",
        description:
          "내 프로그램의 특정 일차(day_index)를 수정/추가한다. workouts 를 주면 그 일차의 워크아웃을 통째로 교체한다(운동은 list_exercises 의 등록 이름만). focus·notes·workouts 를 모두 생략하면 그 일차를 삭제한다.",
        inputSchema: z.object({
          program_id: z.string().uuid(),
          day_index: z.number().int().min(1),
          focus: z.string().max(200).optional(),
          notes: z.string().max(2000).optional(),
          workouts: z
            .array(
              z.object({
                title: z.string().max(80).optional(),
                type: z
                  .enum(["race_sim", "wod", "run", "strength"])
                  .optional(),
                items: z
                  .array(
                    z.object({
                      exercise: z.string().min(1).max(80),
                      note: z.string().max(80).optional(),
                    }),
                  )
                  .min(1)
                  .max(15),
              }),
            )
            .max(5)
            .optional(),
        }),
      },
      async ({ program_id, day_index, focus, notes, workouts }, ctx) =>
        out(
          await rpc("mcp_set_program_day", {
            p_token: tok(ctx),
            p_program: program_id,
            p_day_index: day_index,
            p_focus: focus ?? null,
            p_notes: notes ?? null,
            p_workouts: workouts ?? null,
          }),
        ),
    );

    server.registerTool(
      "attach_crew_program",
      {
        title: "크루에 프로그램 연결 (운영진)",
        description:
          "훈련 프로그램을 크루에 연결해 크루 일정표에 일차별로 표시한다 (운영진 전용, 본인 소유/공개 프로그램만). repeat=true 면 설정 기간 동안 프로그램이 순환 반복된다. 이미 연결돼 있으면 기간·반복을 갱신한다. 연결 전 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          program_id: z.string().uuid(),
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          repeat: z.boolean().optional(),
        }),
      },
      async ({ slug, program_id, start_date, end_date, repeat }, ctx) =>
        out(
          await rpc("mcp_attach_crew_program", {
            p_token: tok(ctx),
            p_slug: slug,
            p_program: program_id,
            ...(start_date ? { p_start_date: start_date } : {}),
            p_end_date: end_date ?? null,
            p_repeat: repeat ?? false,
          }),
        ),
    );

    // ---------- 크루 고도화

    server.registerTool(
      "list_crew_members",
      {
        title: "크루 멤버 목록",
        description:
          "크루의 활성 멤버 명단 — 이름, 역할(owner=리더/coach=부리더/member=정회원/associate=일반회원), 가입일. 운영진 토큰이면 user_id 와 가입 대기자(pending) 목록도 포함.",
        inputSchema: z.object({ slug: z.string() }),
      },
      async ({ slug }, ctx) =>
        out(
          await rpc("mcp_crew_members", { p_token: tok(ctx), p_slug: slug }),
        ),
    );

    server.registerTool(
      "update_crew_meetup",
      {
        title: "크루 모임 수정·취소 (운영진)",
        description:
          "등록된 모임의 제목·시각·장소·설명·정원·정회원 전용·댓글 허용을 부분 수정하거나 취소(cancel=true)한다 (운영진 전용). capacity=0 은 정원 해제(무제한 — 대기자 전원 자동 참석), 정원을 늘리면 대기자가 순서대로 자동 승격된다. event_id 는 get_crew_schedule 에는 없으므로 웹 일정 URL 또는 사용자에게 확인. 수정 전 내용을 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          event_id: z.string().uuid(),
          title: z.string().max(120).optional(),
          starts_at: z.string().optional(),
          location: z.string().max(120).optional(),
          description: z.string().max(4000).optional(),
          members_only: z.boolean().optional(),
          comments_allowed: z.boolean().optional(),
          cancel: z.boolean().optional(),
          capacity: z.number().int().min(0).optional(),
        }),
      },
      async (
        { slug, event_id, title, starts_at, location, description, members_only, comments_allowed, cancel, capacity },
        ctx,
      ) =>
        out(
          await rpc("mcp_update_meetup", {
            p_token: tok(ctx),
            p_slug: slug,
            p_event: event_id,
            p_title: title ?? null,
            p_starts_at: starts_at ?? null,
            p_location: location ?? null,
            p_description: description ?? null,
            p_members_only: members_only ?? null,
            p_comments_allowed: comments_allowed ?? null,
            p_cancel: cancel ?? false,
            p_capacity: capacity ?? null,
          }),
        ),
    );

    server.registerTool(
      "rsvp_meetup",
      {
        title: "모임 참석 체크",
        description:
          "크루 모임에 본인 참석 여부를 등록한다 (going=참석, maybe=미정, declined=불참). 정회원 전용 모임은 정회원만 가능. 정원이 찬 모임에 참석 신청하면 status=waitlisted(대기)로 응답되며 waitlist_position 이 대기 순번 — 공석이 생기면 순서대로 자동 참석 처리된다.",
        inputSchema: z.object({
          event_id: z.string().uuid(),
          status: z.enum(["going", "maybe", "declined"]),
        }),
      },
      async ({ event_id, status }, ctx) =>
        out(
          await rpc("mcp_rsvp", {
            p_token: tok(ctx),
            p_event: event_id,
            p_status: status,
          }),
        ),
    );

    server.registerTool(
      "get_crew_board",
      {
        title: "크루 게시판",
        description:
          "크루 게시판 최근 글 — 카테고리(notice/free/wod/review/recruit/question), 제목, 본문(1000자), 작성자, 고정 여부, 댓글 수. 정회원 전용 글은 권한에 맞게 필터된다. limit 최대 30.",
        inputSchema: z.object({
          slug: z.string(),
          limit: z.number().int().min(1).max(30).optional(),
          category: z
            .enum(["notice", "free", "wod", "review", "recruit", "question"])
            .optional(),
        }),
      },
      async ({ slug, limit, category }, ctx) =>
        out(
          await rpc("mcp_crew_board", {
            p_token: tok(ctx),
            p_slug: slug,
            p_limit: limit ?? 10,
            p_category: category ?? null,
          }),
        ),
    );

    server.registerTool(
      "get_crew_dues",
      {
        title: "크루 회비 현황",
        description:
          "월별 회비 납부 현황 — 본인 상태(unpaid/reported/confirmed). 운영진 토큰이면 멤버별 매트릭스와 미납 인원 수 포함. month 는 YYYY-MM, 기본 이번 달.",
        inputSchema: z.object({
          slug: z.string(),
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        }),
      },
      async ({ slug, month }, ctx) =>
        out(
          await rpc("mcp_dues", {
            p_token: tok(ctx),
            p_slug: slug,
            p_month: month ?? null,
          }),
        ),
    );

    server.registerTool(
      "confirm_dues_payment",
      {
        title: "회비 납부 확정 (운영진)",
        description:
          "멤버의 월 회비 납부를 확정한다 (운영진 전용, 멱등). amount(KRW)를 넣으면 회계에 수입이 자동 기록된다. user_id 는 get_crew_dues 매트릭스에서. 확정 전 사용자에게 누구·얼마인지 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          user_id: z.string().uuid(),
          month: z.string().regex(/^\d{4}-\d{2}$/),
          amount: z.number().int().positive().optional(),
        }),
      },
      async ({ slug, user_id, month, amount }, ctx) =>
        out(
          await rpc("mcp_set_dues_paid", {
            p_token: tok(ctx),
            p_slug: slug,
            p_user_id: user_id,
            p_month: month,
            p_amount: amount ?? null,
          }),
        ),
    );

    server.registerTool(
      "report_my_dues",
      {
        title: "회비 납부 신고 (본인)",
        description:
          "본인이 회비를 납부했다고 신고한다 — 확인 대기(reported) 상태가 되고 운영진이 입금 대조 후 확정한다. month 기본 이번 달.",
        inputSchema: z.object({
          slug: z.string(),
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        }),
      },
      async ({ slug, month }, ctx) =>
        out(
          await rpc("mcp_report_dues", {
            p_token: tok(ctx),
            p_slug: slug,
            p_month: month ?? null,
          }),
        ),
    );
  },
  {
    serverInfo: { name: "roxlogy", version: "2.0.0" },
    instructions:
      "Roxlogy 하이록스 훈련 데이터 API. 시간 값은 밀리초(ms). " +
      "크루 도구의 slug 는 get_profile 의 crews 목록에서 얻는다. " +
      "결과가 null 이면 토큰이 잘못됐거나 접근 권한이 없는 것이다. " +
      "(운영진) 표시 도구는 크루 리더·부리더 토큰만 동작한다. " +
      "쓰기 도구(회계·모임 등록/수정·공지·승인·프로그램 생성/연결·회비 확정)는 " +
      "실행 전 반드시 사용자에게 내용을 확인받는다. " +
      "훈련 계획 문서를 받으면 create_program 으로 일차별 등록 후 " +
      "attach_crew_program 으로 크루 일정표에 연결할 수 있다.",
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
