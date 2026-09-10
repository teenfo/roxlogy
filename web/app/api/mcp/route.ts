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

/** DB 트리거가 던지는 코드 → 도구가 이해할 수 있는 응답.
 *  월 마감처럼 "사용자가 풀면 되는" 상태는 오류가 아니라 답이어야 한다. */
const GUARD_HINTS: Record<string, string> = {
  dues_month_closed:
    "그 달은 마감되어 회비 청구를 바꿀 수 없습니다. close_crew_month 에 reopen:true 로 마감을 풀고 다시 시도하세요.",
  ledger_month_closed:
    "그 달은 마감되어 장부 내역을 바꿀 수 없습니다. 통장 반영일(settle_crew_ledger)만 예외입니다.",
};

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supa().rpc(fn, args);
  if (error) {
    for (const [code, hint] of Object.entries(GUARD_HINTS)) {
      if (error.message.includes(code)) return { error: code, hint };
    }
    throw new Error(error.message);
  }
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
          "slug 없이 호출하면 내 크루 목록, slug 를 주면 그 크루의 소개·위치·운영시간·연락처·운영 정책·멤버 수·내 역할·회비 계좌(bank_account, 크루원에게만).",
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
          "크루 회계에 수입/지출 내역을 기록한다 (운영진 전용). 영수증 사진을 읽었다면 날짜·금액·상호를 추출해 사용하되, 기록 전 사용자에게 내용을 확인받아라. amount 는 KRW 정수(원). " +
          "method(현금·카드·이체·기타)는 알면 넣어라 — 카드값은 통장에 며칠 뒤에 찍혀서 대사할 때 이 구분이 필요하다. 수입에는 카드를 쓰지 않는다(받는 쪽에 카드 결제란 없다) — 계좌로 받았으면 transfer, 현장에서 받았으면 cash 다. " +
          "settled_on 은 그 돈이 실제로 통장에 찍힌 날이다. 아직 안 찍혔으면 비워 두고, 나중에 settle_crew_ledger 로 표시한다. " +
          "마감된 달에는 기록할 수 없다 (error: month_closed).",
        inputSchema: z.object({
          slug: z.string(),
          kind: z.enum(["income", "expense"]),
          amount: z.number().int().positive(),
          title: z.string().min(1).max(120),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          memo: z.string().max(500).optional(),
          method: z.enum(["cash", "card", "transfer", "other"]).optional(),
          settled_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
      async ({ slug, kind, amount, title, date, memo, method, settled_on }, ctx) =>
        out(
          await rpc("mcp_add_ledger", {
            p_token: tok(ctx),
            p_slug: slug,
            p_kind: kind,
            p_amount: amount,
            p_title: title,
            ...(date ? { p_date: date } : {}),
            p_memo: memo ?? null,
            p_method: method ?? null,
            p_settled_on: settled_on ?? null,
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
          "크루 회계 (정회원 전용) — 월 수입/지출 합계, 장부 잔액(total_balance), 통장 잔고(bank_balance = 기초 잔액 + 통장에 찍힌 거래), 미반영 금액(unsettled), 그 달 마감 여부(closed), 해당 월 내역. " +
          "내역마다 entry_id·method(결제 수단)·settled_on(통장에 찍힌 날, null 이면 미반영)·source(dues 면 회비에서 자동 생성된 행)가 붙는다. " +
          "장부 잔액과 통장 잔고가 다르면 그 차이가 곧 아직 통장에 안 들어온 돈이다. month 는 YYYY-MM, 기본 이번 달. 금액은 KRW.",
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

    server.registerTool(
      "settle_crew_ledger",
      {
        title: "통장 반영 표시 (운영진)",
        description:
          "장부 내역을 '통장에 찍혔다'고 표시한다 (운영진 전용). entry_id 하나를 지정하거나, month(YYYY-MM)를 주면 그 달의 미반영 내역을 한 번에 처리한다. " +
          "on(통장에 찍힌 날)을 생략하면 각 내역의 거래일로 본다 — 대부분 같은 날이라 이게 기본이다. 카드값처럼 며칠 뒤에 빠지면 on 을 명시하라. " +
          "clear:true 면 반대로 반영 표시를 지운다. 마감된 달에서도 이 값만은 바꿀 수 있다(9월 지출이 10월 통장에 찍히는 일이 흔해서). 실행 전 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          entry_id: z.string().uuid().optional(),
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
          on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          clear: z.boolean().optional(),
        }),
      },
      async ({ slug, entry_id, month, on, clear }, ctx) =>
        out(
          await rpc("mcp_settle_ledger", {
            p_token: tok(ctx),
            p_slug: slug,
            p_entry_id: entry_id ?? null,
            p_month: month ?? null,
            p_on: on ?? null,
            p_clear: clear ?? false,
          }),
        ),
    );

    server.registerTool(
      "set_crew_bank_opening",
      {
        title: "통장 기초 잔액 (운영진)",
        description:
          "통장 잔고를 계산하려면 시작점이 필요하다 — 장부를 쓰기 시작한 시점의 통장 잔액을 한 번 적어 둔다 (운영진 전용). " +
          "이후로는 통장에 반영 표시한 거래만 더해 잔고가 따라간다. amount 는 KRW 정수, on 은 그 잔액의 기준일. 실행 전 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          amount: z.number().int(),
          on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
      async ({ slug, amount, on }, ctx) =>
        out(
          await rpc("mcp_set_bank_opening", {
            p_token: tok(ctx),
            p_slug: slug,
            p_amount: amount,
            p_on: on ?? null,
          }),
        ),
    );

    server.registerTool(
      "close_crew_month",
      {
        title: "회계 월 마감 (운영진)",
        description:
          "그 달의 회계를 마감한다 (운영진 전용). 마감하면 그 달의 회비 청구(확정·면제·신고·대사)와 장부 내역(추가·수정·삭제)이 모두 막힌다 — 화면뿐 아니라 DB 가 막으므로 이 서버의 다른 도구도 거부된다. 통장 반영일만 예외다. " +
          "응답의 open_charges(아직 못 받은 청구)·unsettled_entries(통장 미반영 내역)를 먼저 사용자에게 알리고, 남아 있는데도 마감할지 확인받아라. reopen:true 로 언제든 다시 풀 수 있다.",
        inputSchema: z.object({
          slug: z.string(),
          period: z.string().regex(/^\d{4}-\d{2}$/),
          reopen: z.boolean().optional(),
        }),
      },
      async ({ slug, period, reopen }, ctx) =>
        out(
          await rpc("mcp_close_month", {
            p_token: tok(ctx),
            p_slug: slug,
            p_period: period,
            p_reopen: reopen ?? false,
          }),
        ),
    );

    // ---------- 훈련 프로그램

    server.registerTool(
      "list_exercises",
      {
        title: "운동 DB 목록",
        description:
          "Roxlogy 운동 DB — 프로그램 워크아웃 아이템에 쓸 수 있는 운동 목록(name_ko/name_en/aliases, 스테이션 타입). 매칭은 대소문자·공백을 무시하고 별칭도 인정한다. 워크아웃을 만들기 전에 먼저 조회해서 이 목록의 이름만 사용하라.",
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
          "운동 DB 에 없는 운동의 등록을 요청한다 (관리자 승인 후 추가됨 — 승인 전에는 워크아웃에 쓸 수 없다). 이미 있는 운동이면 already_exists, 표기만 다를 수 있는 유사 운동이 있으면 similar_existing 후보를 돌려준다 — 사용자에게 같은 운동인지 확인하고, 같은 운동이면 그 등록 이름을 쓰고, 정말 새 운동이면 confirm_new=true 로 재요청하라.",
        inputSchema: z.object({
          name_ko: z.string().min(1).max(60),
          name_en: z.string().max(60).optional(),
          note: z.string().max(300).optional(),
          confirm_new: z.boolean().optional(),
        }),
      },
      async ({ name_ko, name_en, note, confirm_new }, ctx) =>
        out(
          await rpc("mcp_request_exercise", {
            p_token: tok(ctx),
            p_name_ko: name_ko,
            p_name_en: name_en ?? null,
            p_note: note ?? null,
            p_confirm_new: confirm_new ?? false,
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
          "훈련 프로그램 1건의 상세 — 일차별(day_index) focus·notes·rest(워크아웃이 없는 휴식일) 와 워크아웃(items 의 exercise + 구조화 처방 distance_m·weight_kg·reps·sets·duration_s·rest_s·note), 훈련 요일(week_pattern, 0=월 … 6=일), 공개 여부, 내 소유 여부(is_mine), 내 등록 시작일(my_start_date). 내 프로그램, 공개 프로그램, 내 크루에 연결된 프로그램을 볼 수 있다.",
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
          "workouts 아이템의 exercise 는 운동 DB(list_exercises)에 등록된 이름(한/영)만 허용 — 미등록 이름이 있으면 unknown_exercises 로 전체 거부되며 이름별 유사 후보(suggestions)가 함께 온다 — 표기 차이로 보이면 사용자 확인 후 후보 이름으로 재시도하고, 실제 없는 운동은 request_exercise 로 등록을 요청하라. " +
          "아이템 처방은 숫자 필드로 구조화해 넣어라: distance_m(거리 m)·weight_kg(무게)·reps(세트당 횟수)·sets(세트)·duration_s(시간 초)·rest_s(세트 사이 휴식 초) — 통계 집계에 쓰이므로 '400m 8세트 세트간 90초'는 note 가 아니라 distance_m:400, sets:8, rest_s:90 으로. note 에는 강도·큐잉 등 숫자로 안 담기는 것만. " +
          "week_pattern 은 훈련 요일 배열(0=월 … 6=일, 예: [0,2,4] = 월·수·금). 넣으면 빌더가 '3일차 = 금요일'을 보여주고 주 단위로 묶어 준다 — 주 N회 계획이면 꼭 넣어라. " +
          "workouts 를 생략한 일차는 휴식일로 남는다 — 주간 패턴에 맞춰 쉬는 날도 일차로 만들어 두면 일정이 요일과 어긋나지 않는다. " +
          "프로그램은 날짜 없는 템플릿이다 — 만든 뒤 start_program 으로 내 일정에 시작하거나 attach_crew_program 으로 크루 일정표에 연결해야 날짜가 붙는다. 생성 전 사용자에게 구성을 확인받아라.",
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
                      distance_m: z.number().min(1).max(200000).optional(),
                      weight_kg: z.number().gt(0).max(1000).optional(),
                      reps: z.number().int().min(1).max(10000).optional(),
                      sets: z.number().int().min(1).max(100).optional(),
                      duration_s: z.number().int().min(1).max(86400).optional(),
                      rest_s: z.number().int().min(1).max(3600).optional(),
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
          week_pattern: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
        }),
      },
      async ({ title, weeks, days, level, description, week_pattern }, ctx) =>
        out(
          await rpc("mcp_create_program", {
            p_token: tok(ctx),
            p_title: title,
            p_weeks: weeks,
            p_days: days,
            p_level: level ?? "intermediate",
            p_description: description ?? null,
            p_week_pattern: week_pattern ?? null,
          }),
        ),
    );

    server.registerTool(
      "set_program_day",
      {
        title: "프로그램 일차 수정",
        description:
          "내 프로그램의 특정 일차(day_index)를 수정/추가한다. workouts 를 주면 그 일차의 워크아웃을 통째로 교체한다(운동은 list_exercises 의 등록 이름만). 아이템 처방은 distance_m·weight_kg·reps·sets·duration_s·rest_s 숫자 필드로 구조화하고 note 에는 강도·큐잉만. " +
          "workouts 에 빈 배열([])을 주면 그 일차는 휴식일이 된다(일차는 남고 워크아웃만 사라진다). focus·notes·workouts 를 모두 생략하면 그 일차 자체를 삭제한다. 워크아웃 교체·일차 삭제는 되돌릴 수 없으니 실행 전 사용자에게 확인받아라.",
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
                      distance_m: z.number().min(1).max(200000).optional(),
                      weight_kg: z.number().gt(0).max(1000).optional(),
                      reps: z.number().int().min(1).max(10000).optional(),
                      sets: z.number().int().min(1).max(100).optional(),
                      duration_s: z.number().int().min(1).max(86400).optional(),
                      rest_s: z.number().int().min(1).max(3600).optional(),
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
      "update_program",
      {
        title: "프로그램 기본 정보 수정",
        description:
          "내 프로그램의 기본 정보를 고친다 — 제목·설명·기간(weeks)·레벨·공개 여부·훈련 요일(week_pattern). 일차 구성은 set_program_day 로 한다. " +
          "생략한 값은 그대로 둔다. is_public 을 켜면 모든 Roxlogy 사용자에게 보이므로 반드시 사용자에게 확인받아라.",
        inputSchema: z.object({
          program_id: z.string().uuid(),
          title: z.string().min(1).max(120).optional(),
          description: z.string().max(2000).optional(),
          weeks: z.number().int().min(1).max(20).optional(),
          level: z.enum(["beginner", "intermediate", "advanced", "elite"]).optional(),
          is_public: z.boolean().optional(),
          week_pattern: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
        }),
      },
      async (
        { program_id, title, description, weeks, level, is_public, week_pattern },
        ctx,
      ) =>
        out(
          await rpc("mcp_update_program", {
            p_token: tok(ctx),
            p_program: program_id,
            p_title: title ?? null,
            p_description: description ?? null,
            p_weeks: weeks ?? null,
            p_level: level ?? null,
            p_is_public: is_public ?? null,
            p_week_pattern: week_pattern ?? null,
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

    server.registerTool(
      "start_program",
      {
        title: "프로그램 시작 (내 일정)",
        description:
          "훈련 프로그램을 내 일정으로 시작한다 — 이때 비로소 일차에 날짜가 붙어 get_today 의 오늘 훈련에 나온다. start_date 를 비우면 오늘(KST)부터. " +
          "활성 프로그램은 1개뿐이라 이미 진행 중인 게 있으면 자동으로 교체된다(같은 트랜잭션이라 중간 상태로 남지 않는다). " +
          "repeat=true 면 end_date 까지 프로그램이 순환 반복하고, end_date 를 비우면 중지할 때까지 무기한이다. repeat=false 면 일차 수만큼 돌고 끝난다(end_date 는 무시). " +
          "본인 소유·공개·내 크루에 연결된 프로그램만 시작할 수 있다. 시작 전 사용자에게 프로그램과 시작일을 확인받아라.",
        inputSchema: z.object({
          program_id: z.string().uuid(),
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          repeat: z.boolean().optional(),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
      async ({ program_id, start_date, repeat, end_date }, ctx) =>
        out(
          await rpc("mcp_start_program", {
            p_token: tok(ctx),
            p_program: program_id,
            p_start_date: start_date ?? null,
            p_repeat: repeat ?? false,
            p_end_date: end_date ?? null,
          }),
        ),
    );

    server.registerTool(
      "stop_program",
      {
        title: "프로그램 중지 (내 일정)",
        description:
          "진행 중인 프로그램을 중지한다. program_id 를 비우면 현재 활성 프로그램을 중지한다. 기록은 남고 일정만 멈춘다. 중지 전 사용자에게 확인받아라.",
        inputSchema: z.object({
          program_id: z.string().uuid().optional(),
        }),
      },
      async ({ program_id }, ctx) =>
        out(
          await rpc("mcp_stop_program", {
            p_token: tok(ctx),
            p_program: program_id ?? null,
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

    // ---------- 출석 (이번 릴리스) ----------
    server.registerTool(
      "get_meetup_attendance",
      {
        title: "모임 출석 명단 (운영진)",
        description:
          "모임 한 건의 크루원별 출석·참석 응답·회차비 상태. 무료 행사/정회원 전용/종료 여부도 함께. event_id 는 get_crew_schedule 의 모임 id.",
        inputSchema: z.object({ slug: z.string(), event_id: z.string().uuid() }),
      },
      async ({ slug, event_id }, ctx) =>
        out(
          await rpc("mcp_event_attendance", {
            p_token: tok(ctx),
            p_slug: slug,
            p_event: event_id,
          }),
        ),
    );

    server.registerTool(
      "check_in_member",
      {
        title: "모임 출석 체크 (운영진)",
        description:
          "크루원의 출석을 체크하거나 해제한다. 등급에 회차비가 있으면 체크와 동시에 자동 청구되고, 해제하면 아직 손대지 않은 청구만 회수된다. 무료 행사는 출석만 남고 청구되지 않는다. 실행 전 누구를 체크하는지 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          event_id: z.string().uuid(),
          user_id: z.string().uuid(),
          present: z.boolean().optional(),
        }),
      },
      async ({ slug, event_id, user_id, present }, ctx) =>
        out(
          await rpc("mcp_check_in", {
            p_token: tok(ctx),
            p_slug: slug,
            p_event: event_id,
            p_user_id: user_id,
            p_present: present ?? true,
          }),
        ),
    );

    server.registerTool(
      "set_meetup_flags",
      {
        title: "모임 상태 변경 (운영진)",
        description:
          "무료 행사·정회원 전용·종료 여부를 바꾼다. 지정하지 않은 항목은 그대로 둔다. 무료로 바꾸면 그 모임의 미납 회차비가 회수되고, 유료로 되돌리면 출석분이 다시 청구된다(확정분은 그대로). 종료하면 크루원이 참석 여부를 바꿀 수 없다. 실행 전 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          event_id: z.string().uuid(),
          free: z.boolean().optional(),
          members_only: z.boolean().optional(),
          closed: z.boolean().optional(),
        }),
      },
      async ({ slug, event_id, free, members_only, closed }, ctx) =>
        out(
          await rpc("mcp_set_meetup_flags", {
            p_token: tok(ctx),
            p_slug: slug,
            p_event: event_id,
            p_fee_exempt: free ?? null,
            p_members_only: members_only ?? null,
            p_closed: closed ?? null,
          }),
        ),
    );

    // ---------- 회원 등급 ----------
    server.registerTool(
      "list_crew_tiers",
      {
        title: "크루 회원 등급",
        description:
          "크루가 정한 회원 등급과 요금(월회비·회차비), 정회원 권한 여부, 등급별 인원. 등급 이름은 크루마다 다르므로 set_member_tier 전에 먼저 확인한다.",
        inputSchema: z.object({ slug: z.string() }),
      },
      async ({ slug }, ctx) =>
        out(await rpc("mcp_crew_tiers", { p_token: tok(ctx), p_slug: slug })),
    );

    server.registerTool(
      "set_member_tier",
      {
        title: "크루원 등급 지정 (운영진)",
        description:
          "크루원의 등급을 바꾼다. tier 는 list_crew_tiers 의 이름 그대로. 등급이 곧 요금표라 다음 회비 대사부터 새 요금이 적용된다. 실행 전 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          user_id: z.string().uuid(),
          tier: z.string(),
        }),
      },
      async ({ slug, user_id, tier }, ctx) =>
        out(
          await rpc("mcp_set_member_tier", {
            p_token: tok(ctx),
            p_slug: slug,
            p_user_id: user_id,
            p_tier: tier,
          }),
        ),
    );

    // ---------- 회비 ----------
    server.registerTool(
      "get_crew_unpaid",
      {
        title: "크루 미납 내역 (운영진)",
        description:
          "기간 무관 전체 미납·확인 대기 청구를 회원별로. 확정·면제된 건은 빠진다. 특정 달만 보려면 get_crew_dues.",
        inputSchema: z.object({ slug: z.string() }),
      },
      async ({ slug }, ctx) =>
        out(await rpc("mcp_crew_unpaid", { p_token: tok(ctx), p_slug: slug })),
    );

    server.registerTool(
      "sync_crew_dues",
      {
        title: "회비 청구 맞추기 (운영진)",
        description:
          "그 달의 청구를 현재 등급·요금·출석 기록에 맞춘다. 없던 청구는 만들고, 미납 청구의 금액은 갱신하고, 근거가 사라진 미납 청구는 회수한다. 이미 확정했거나 본인이 납부 신고한 청구는 절대 다시 발행하거나 금액을 바꾸지 않는다. kind: monthly(월회비) / session(회차비) / both(기본). 실행 전 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
          kind: z.enum(["monthly", "session", "both"]).optional(),
        }),
      },
      async ({ slug, month, kind }, ctx) =>
        out(
          await rpc("mcp_sync_dues", {
            p_token: tok(ctx),
            p_slug: slug,
            p_month: month ?? null,
            p_kind: kind ?? "both",
          }),
        ),
    );

    server.registerTool(
      "waive_dues_charge",
      {
        title: "회비 면제 (운영진)",
        description:
          "청구 1건을 면제 처리한다. 면제는 미납도 수입도 아니어서 회계에 아무것도 기록되지 않는다. 이미 확정된 건은 먼저 확정을 해제해야 한다. charge_id 는 get_crew_unpaid 또는 get_crew_dues 에서. 실행 전 누구의 무슨 청구를 왜 면제하는지 사용자에게 확인받아라.",
        inputSchema: z.object({
          slug: z.string(),
          charge_id: z.string().uuid(),
          reason: z.string().max(200).optional(),
        }),
      },
      async ({ slug, charge_id, reason }, ctx) =>
        out(
          await rpc("mcp_waive_dues", {
            p_token: tok(ctx),
            p_slug: slug,
            p_charge: charge_id,
            p_reason: reason ?? null,
          }),
        ),
    );

    // ---------- 통계 ----------
    server.registerTool(
      "get_crew_stats",
      {
        title: "크루원 통계 (운영진)",
        description:
          "인원·대기 신청·등급 분포, 크루원별 출석(유료 모임 / 무료 포함 전체), 미납·면제 합계.",
        inputSchema: z.object({ slug: z.string() }),
      },
      async ({ slug }, ctx) =>
        out(await rpc("mcp_crew_stats", { p_token: tok(ctx), p_slug: slug })),
    );

    // ---------- PFT ----------
    server.registerTool(
      "list_pft",
      {
        title: "내 PFT 기록",
        description:
          "PFT(체력 측정) 기록. 6종목을 쉬는 시간 없이 연속으로 하고 총 시간으로 채점한다. badge 는 gold/silver/bronze — 45세 미만 22분·26분, 45세 이상 24분·28분 기준이고 동작을 수정하면(scaled) 무조건 bronze.",
        inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      },
      async ({ limit }, ctx) =>
        out(await rpc("mcp_list_pft", { p_token: tok(ctx), p_limit: limit ?? 20 })),
    );

    server.registerTool(
      "add_pft",
      {
        title: "PFT 기록 추가",
        description:
          "PFT 결과를 저장한다. total_ms 만 있으면 되고 구간 기록은 선택이다. 순서는 1000m 런 → 버피 브로드 점프 50 → 런지 100 → 1000m 로우 → 푸시업 30 → 월볼 100. 배지는 저장 시점의 나이·scaled 로 서버가 판정한다. 실행 전 기록 내용을 사용자에게 확인받아라.",
        inputSchema: z.object({
          total_ms: z.number().int(),
          tested_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          run_ms: z.number().int().optional(),
          burpee_ms: z.number().int().optional(),
          lunge_ms: z.number().int().optional(),
          row_ms: z.number().int().optional(),
          pushup_ms: z.number().int().optional(),
          wallball_ms: z.number().int().optional(),
          scaled: z.boolean().optional(),
          location: z.string().max(80).optional(),
        }),
      },
      async (a, ctx) =>
        out(
          await rpc("mcp_add_pft", {
            p_token: tok(ctx),
            p_total_ms: a.total_ms,
            p_tested_on: a.tested_on ?? null,
            p_run_ms: a.run_ms ?? null,
            p_burpee_ms: a.burpee_ms ?? null,
            p_lunge_ms: a.lunge_ms ?? null,
            p_row_ms: a.row_ms ?? null,
            p_pushup_ms: a.pushup_ms ?? null,
            p_wallball_ms: a.wallball_ms ?? null,
            p_scaled: a.scaled ?? false,
            p_location: a.location ?? null,
          }),
        ),
    );
  },
  {
    serverInfo: { name: "roxlogy", version: "3.2.0" },
    // 이 서버는 도구만 등록한다 — resource·prompt·서버발 알림이 하나도 없다.
    // 기본값(1024)이면 클라이언트의 구독 요청에 SSE 스트림을 열어 주는데, 보낼
    // 게 없으니 그 스트림은 아무 일도 안 하면서 함수를 붙잡고 있다가 300초
    // maxDuration 에 걸려 죽고, 클라이언트는 곧바로 다시 연결한다 — 5분마다
    // 무한 반복(2026-09 운영 로그에서 확인). 0 이면 스트림을 안 열고 거절한다.
    maxSubscriptions: 0,
    // 어떤 메서드가 오래 잡고 있는지 남긴다. 인자는 개인정보가 섞일 수 있어
    // 기록하지 않고 메서드 이름과 소요시간만 남긴다.
    onEvent: (e) => {
      if (e.type === "REQUEST_COMPLETED" && (e.duration ?? 0) > 5000) {
        console.warn(`[mcp] slow ${e.method} ${e.duration}ms`);
      } else if (e.type === "ERROR") {
        // 구독 거절은 설계대로 동작한 것이다(maxSubscriptions: 0). 클라이언트는
        // 계속 재시도하므로 error 로 남기면 Vercel 오류 대시보드가 이걸로 덮여
        // 진짜 오류가 묻힌다.
        const msg = e.error instanceof Error ? e.error.message : String(e.error);
        if (!msg.includes("subscriptions/listen refused")) {
          console.error(`[mcp] error`, e.error);
        }
      }
    },
    instructions:
      "Roxlogy 하이록스 훈련 데이터 API. 시간 값은 밀리초(ms). " +
      "크루 도구의 slug 는 get_profile 의 crews 목록에서 얻는다. " +
      '응답이 {"error":"not_found_or_invalid_token"} 이면 토큰이 잘못됐거나 접근 권한이 없는 것이다 — 빈 목록([])과 구분된다. ' +
      "(운영진) 표시 도구는 크루 리더·부리더 토큰만 동작한다. " +
      "쓰기 도구(회계 기록·통장 반영·기초 잔액·월 마감·모임 등록/수정/상태변경·공지·승인·등급 지정·출석 체크·" +
      "회비 확정/맞추기/면제·프로그램 생성/수정/일차 수정/시작/중지·크루 연결·PFT 기록·운동 등록 요청)는 " +
      "실행 전 반드시 사용자에게 내용을 확인받는다. " +
      "훈련 계획 문서를 받으면 create_program 으로 일차별 등록 후 " +
      "start_program 으로 내 일정에 시작하거나 attach_crew_program 으로 크루 " +
      "일정표에 연결할 수 있다. 프로그램은 날짜 없는 템플릿이라 둘 중 하나를 " +
      "해야 날짜가 붙는다. 개인 활성 프로그램은 1개뿐이라 새로 시작하면 교체된다. " +
      "회비 구조: 등급(list_crew_tiers)이 곧 요금표다 — 등급마다 월회비·회차비를 " +
      "가진다. 월회비는 sync_crew_dues 로 그 달을 맞추고, 회차비는 모임 출석을 " +
      "체크하면 자동으로 청구된다. 무료 행사로 표시한 모임은 출석은 남지만 " +
      "청구되지 않는다. 이미 확정했거나 본인이 납부 신고한 청구는 어떤 경로로도 " +
      "다시 발행되거나 금액이 바뀌지 않는다. " +
      "회계는 장부와 통장을 따로 본다: 장부 잔액은 기록한 모든 거래이고, 통장 " +
      "잔고는 기초 잔액(set_crew_bank_opening) + 통장에 반영 표시한 거래다. " +
      "둘의 차이가 아직 통장에 안 들어온 돈이라 대사가 된다 — 입금·출금을 " +
      "확인했으면 settle_crew_ledger 로 표시한다. 회비를 확정하면 장부에 " +
      "수입(source=dues)이 자동으로 생기고, 그 행도 똑같이 통장 반영 대상이다. " +
      "한 달을 다 정리했으면 close_crew_month 로 마감한다 — 마감된 달은 회비 " +
      "청구도 장부도 잠기고(error: dues_month_closed / ledger_month_closed), " +
      "통장 반영일만 열려 있다. 마감은 reopen 으로 풀 수 있다.",
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

// 도구는 전부 Supabase RPC 한 번이라 60초면 충분하다. 기본 300초로 두면
// 어떤 이유로든 매달린 요청이 함수 시간을 5분씩 태운다 (Hobby 플랜 한도에 직결).
export const maxDuration = 60;

export { authed as GET, authed as POST, authed as DELETE };
