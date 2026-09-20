/**
 * 디자인 리뉴얼용 픽스처 Supabase 클라이언트 (개발/캡쳐 전용).
 *
 * 리뉴얼 전/후를 비교하려면 68개 라우트를 전부 같은 조건으로 찍어야 하는데,
 * 샌드박스에서는 supabase.co 로 나갈 수 없다. 그래서 `@supabase/ssr` 자체를
 * 이 모듈로 갈아끼운다(`next.config.ts`, `ROX_FIXTURES=1` 일 때만) — 그러면
 * `lib/supabase/server.ts`·`client.ts`·`proxy.ts` 가 전부 한 번에 덮인다.
 *
 * **레이아웃은 실제 코드 그대로이고 데이터만 가짜다.** 화면 구조를 보는 게
 * 목적이므로 RLS·조인·필터를 흉내 내지 않는다. 대신 PostgREST select 문자열을
 * 파싱해 **요청한 모양 그대로** 행을 만들어 준다 — 그래야 페이지마다 픽스처를
 * 손으로 쓰지 않고도 전 화면이 그려진다.
 *
 * 로그인 상태는 `rox_fixture_auth` 쿠키로 바꾼다(기본 로그인, `out` 이면 비로그인).
 * 미들웨어가 `/` ·`/login` 을 대시보드로 보내 버리기 때문에 공개 화면을 찍으려면
 * 이 스위치가 필요하다. 쿠키로 둔 덕에 서버를 다시 띄우지 않아도 된다.
 */

type Row = Record<string, unknown>;

export const FIXTURE_USER_ID = "00000000-0000-4000-8000-000000000001";

/** 값이 정해진 목록 밖으로 나가면 화면이 깨지는 컬럼들 */
const ENUMS: Record<string, readonly string[]> = {
  kind: ["income", "expense"],
  division: ["open", "pro", "doubles", "mixed_doubles", "relay"],
  status: ["active", "confirmed", "upcoming", "pending"],
  role: ["owner", "coach", "member"],
  source: ["watch", "manual", "garmin"],
  type: ["sim", "race", "strength", "running"],
  method: ["transfer", "cash", "card"],
  category: ["dues_monthly", "venue", "snack", "gear"],
  level: ["beginner", "intermediate", "advanced"],
  gender: ["male", "female"],
  state: ["going", "maybe", "out"],
  period: ["2026-09"],
  cat: ["notice", "free", "wod", "review"],
};

const NAMES = ["김초호", "권영훈", "박지민", "이수현", "최민재", "정하늘"];
const TITLES = [
  "9월 월회비",
  "체육관 대관료",
  "하이록스 시뮬 8라운드",
  "인터벌 러닝 5km",
  "LOOP8 정기 모임",
  "스테이션 보강 훈련",
];

/** 복수형 규칙에 안 걸리지만 배열(jsonb)인 컬럼들 */
const ARRAY_COLS = new Set(["going", "waitlist", "roster", "lineup"]);

/** 원소가 **객체**인 배열 컬럼. 문자열을 주면 화면이 `c.body.trim()` 같은 데서
 *  터진다(2026-09-18: 크루 모임 상세·게시글 상세가 프로덕션에서만 죽던 원인).
 *  `*_names` 처럼 문자열 배열인 컬럼과 구분해야 해서 목록으로 둔다. */
const OBJECT_ARRAY_COLS = new Set([
  "comments", "changes", "partners", "entries", "members", "attendees",
  "posts", "items", "replies", "invites",
]);

/** 's' 로 끝나지만 배열이 아닌 컬럼들 — 배열로 만들면 오히려 화면이 깨진다 */
const SCALAR_PLURALS = new Set([
  "status", "address", "progress", "notes", "weeks", "stats", "access",
  "focus", "bonus", "gas", "class", "series", "analysis", "basis", "details",
]);

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** 컬럼 이름만 보고 그럴듯한 값을 만든다. 같은 입력이면 항상 같은 값(캡쳐 안정성). */
function valueFor(col: string, i: number): unknown {
  const c = col.toLowerCase();
  if (ENUMS[c]) return ENUMS[c][i % ENUMS[c].length];
  // 권한·상태는 **항상 가장 센 값**으로 고정한다. 운영진 전용 화면(크루 관리·
  // PFT 스태프)이 notFound() 로 떨어지면 그 화면을 아예 못 찍는다.
  if (c.endsWith("_role")) return "owner";
  if (c.endsWith("_status")) return "active";
  if (c === "splits" || c.endsWith("_splits")) return [300, 320, 310, 305, 315, 325, 318, 308];
  // 곡선(jsonb)은 [t, v] 쌍의 배열이다 — 스칼라를 주면 차트가 map 하다가 터진다
  if (c.endsWith("_curve") || c.endsWith("_series")) {
    return [0, 1, 2, 3, 4, 5].map((j) => [j * 60, 300 + ((i + j) % 5) * 8]);
  }
  if (ARRAY_COLS.has(c) || OBJECT_ARRAY_COLS.has(c)) {
    return [0, 1, 2].map((j) => ({
      id: uuid(i + j + 300),
      user_id: uuid(i + j + 1),
      author_id: uuid(i + j + 1),
      display_name: NAMES[(i + j) % NAMES.length],
      author_name: NAMES[(i + j) % NAMES.length],
      name: NAMES[(i + j) % NAMES.length],
      body: "픽스처 댓글입니다.",
      status: "going",
      created_at: `2026-09-0${((i + j) % 9) + 1}T09:30:00.000Z`,
    }));
  }
  // 복수형 컬럼(jsonb 배열·집계 이름 목록 등)은 배열로 준다. 스칼라를 주면
  // 화면에서 .map()·.slice() 를 돌다가 터진다 — 배열이면 최소한 비어 보일 뿐이다.
  if (c.endsWith("s") && !SCALAR_PLURALS.has(c) && !c.endsWith("ss") && !c.endsWith("_ms")) {
    const singular = c.replace(/s$/, "");
    return [0, 1, 2].map((j) => valueFor(singular, i + j));
  }
  if (c === "id" || c.endsWith("_id")) return uuid(i + 1);
  if (c === "slug") return "loop8";
  if (c === "code") return "QT2S7L";
  if (c === "token" || c.endsWith("_token")) return "fixture-token";
  if (c.endsWith("_at")) return `2026-09-0${(i % 9) + 1}T09:30:00.000Z`;
  if (c.endsWith("_on") || c.endsWith("_date") || c === "date") {
    return `2026-09-0${(i % 9) + 1}`;
  }
  if (c.startsWith("is_") || c.startsWith("has_")) return i % 2 === 0;
  if (["shared", "active", "disabled", "scaled", "public", "repeat"].includes(c)) {
    return i % 3 === 0;
  }
  if (c.endsWith("_ms") || c === "total_ms") return 3_600_000 + i * 90_000;
  if (c === "amount" || c.endsWith("_amount") || c.includes("fee")) {
    return 30000 + i * 1000;
  }
  if (c === "count" || c.endsWith("_count") || c === "seq" || c === "day_index") {
    return i + 1;
  }
  if (["weeks", "age", "rank", "year", "birth_year", "page"].includes(c)) {
    return c === "birth_year" ? 1988 : i + 1;
  }
  if (c.includes("name") || c === "athlete" || c === "author") {
    return NAMES[i % NAMES.length];
  }
  if (c === "title" || c === "label" || c === "focus") return TITLES[i % TITLES.length];
  if (c === "description" || c === "note" || c === "notes" || c === "memo" || c === "body") {
    return "픽스처 데이터입니다. 실제 기록이 아닙니다.";
  }
  if (c === "email") return "fixture@roxlogy.com";
  if (c === "avatar_url" || c === "logo_url" || c === "cover_url") return null;
  return `${col} ${i + 1}`;
}

type Node = { name: string; children: Node[] | null };

/**
 * PostgREST select 문자열 파서.
 * `a, b, rel ( c, rel2 ( d ) )` 를 트리로 쪼갠다. `alias:col` 은 alias 를 키로 쓴다.
 */
function parseSelect(sel: string): Node[] {
  const out: Node[] = [];
  let depth = 0;
  let buf = "";
  const flush = () => {
    const raw = buf.trim();
    buf = "";
    if (!raw) return;
    const open = raw.indexOf("(");
    if (open === -1) {
      const name = raw.split(":").pop()!.split("::")[0].trim();
      if (name) out.push({ name, children: null });
      return;
    }
    const head = raw.slice(0, open).trim();
    // `alias:rel`, `rel!inner`, `rel!fk_name` — 결과 키는 alias 또는 관계 이름이다.
    // `!inner` 를 떼지 않으면 키가 "rel!inner" 가 돼서 페이지가 undefined 를 읽는다.
    const name = (head.includes(":") ? head.split(":")[0] : head).split("!")[0].trim();
    const inner = raw.slice(open + 1, raw.lastIndexOf(")"));
    out.push({ name, children: parseSelect(inner) });
  };
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) flush();
    else buf += ch;
  }
  flush();
  return out;
}

function buildRow(nodes: Node[], i: number): Row {
  const row: Row = {};
  for (const n of nodes) {
    if (!n.children) {
      row[n.name] = valueFor(n.name, i);
      continue;
    }
    // 집계(`rel(count)`)는 한 줄, 나머지 관계는 3줄.
    //
    // PostgREST 는 다대일이면 객체를, 일대다면 배열을 준다. select 문자열만 보고는
    // 어느 쪽인지 알 수 없어서 **배열에 첫 행의 필드를 얹어** 둘 다로 동작하게 한다 —
    // `rel.map()`·`one(rel)`·`rel.name` 이 전부 통한다.
    const onlyCount = n.children.length === 1 && n.children[0].name === "count";
    const n_ = onlyCount ? 1 : 3;
    const arr = Array.from({ length: n_ }, (_, j) =>
      onlyCount ? { count: 3 } : buildRow(n.children!, i + j),
    );
    row[n.name] = Object.assign(arr, arr[0]);
  }
  return row;
}

function rowsFor(select: string, n: number): Row[] {
  if (!select || select.trim() === "*") {
    return Array.from({ length: n }, (_, i) => ({
      id: uuid(i + 1),
      user_id: FIXTURE_USER_ID,
      title: TITLES[i % TITLES.length],
      display_name: NAMES[i % NAMES.length],
      is_admin: true,
      disabled: false,
      created_at: "2026-09-01T00:00:00.000Z",
    }));
  }
  const nodes = parseSelect(select);
  return Array.from({ length: n }, (_, i) => {
    const row = buildRow(nodes, i);
    // 소유권 판정이 흔해서 넣어 둔다 — 없으면 "내 것" 화면이 전부 빈다
    if ("user_id" in row) row.user_id = FIXTURE_USER_ID;
    if ("owner_id" in row) row.owner_id = FIXTURE_USER_ID;
    if ("created_by" in row) row.created_by = FIXTURE_USER_ID;
    if ("is_admin" in row) row.is_admin = true;
    if ("disabled" in row) row.disabled = false;
    return row;
  });
}

/**
 * RPC 반환 모양. `pg_get_function_result()` 로 실제 정의에서 뽑은 컬럼 목록이라
 * 페이지가 읽는 키가 실제와 같다. 여기 없는 RPC 는 빈 목록을 돌려준다 —
 * 모양이 틀린 행을 주는 것보다 빈 상태로 그리는 쪽이 정직하다.
 */
const RPC_SHAPES: Record<string, string> = {
  crew_calendar:
    "kind, on_date, starts_at, ref_id, title, subtitle, member_id, member_name, going_count, my_status, result_ms, members_only, fee_exempt, closed, event_id",
  crew_directory:
    "slug, name, tagline, logo_url, location, join_policy, member_count, post_count, description, last_active_at, member_names",
  crew_event_detail:
    "id, slug, title, description, kind, starts_at, ends_at, location, capacity, going, maybe_names, declined_names, my_status, is_staff, comments_allowed, comments, waitlist_names, fee_exempt, members_only, closed_at",
  my_race_plan:
    "id, title, race_date, division, bib, note, goal_plan_id, race_event_id, role, my_status, owner_name, partners, goal_target_ms, goal_run_ms, goal_station_ms, goal_roxzone_ms",
  public_profile: "display_name, division, shared_count, leaderboard_opt_in, instagram",
  public_program_stats: "program_id, owner_name, enroll_count",
  race_event_crewmates: "user_id, display_name, crew_slug, crew_name, division, race_date",
};
RPC_SHAPES.my_race_plans = RPC_SHAPES.my_race_plan;
RPC_SHAPES.crew_board =
  "id, category, title, body, image_urls, author_id, author_name, author_division, pinned, comment_count, like_count, liked_by_me, created_at, members_only";
RPC_SHAPES.crew_leaderboard =
  "rank, user_id, display_name, division, best_ms, session_count, last_at";
RPC_SHAPES.crew_month_going_names = "event_id, names";
RPC_SHAPES.crew_post_detail =
  "id, category, title, body, image_urls, author_id, author_name, pinned, members_only, comment_count, like_count, liked_by_me, created_at, comments";
RPC_SHAPES.crew_overview =
  "id, slug, name, tagline, description, logo_url, cover_url, location, home_gym, links, member_count, post_count, upcoming_count, my_role, my_status, crew_status";
RPC_SHAPES.crew_roster =
  "user_id, display_name, email, division, role, joined_at, session_count, attend_count, attend_paid_count, tier_id, tier_name, tier_color";

/** jsonb 로 **객체 하나**를 돌려주는 RPC — 목록이 아니라 행 하나여야 한다 */
const RPC_OBJECTS: Record<string, string> = {
  admin_user_detail:
    "id, email, email_confirmed_at, last_sign_in_at, created_at, updated_at, display_name, division, gender, birth_year, height_cm, weight_kg, timezone, locale, wod_reminder_time, hyrox_athlete_name, instagram, leaderboard_opt_in, is_admin, disabled, has_mcp_token, session_count, last_session_at, race_count, pft_count, program_count, crews",
};

/** jsonb·스칼라를 돌려주는 RPC — 모양을 지어내지 않고 안전한 기본값만 준다 */
const RPC_SCALARS: Record<string, unknown> = {
  pft_race_can_manage: true,
  // 크루 관리 통계 — jsonb 객체다. 문자열을 주면 stats.tiers 에서 터진다.
  crew_member_stats: {
    members: 26, pending: 3, joined_30d: 4,
    tiers: [
      { name: "정회원", color: "#ffd500", count: 12 },
      { name: "준회원", color: "#8ecae6", count: 9 },
      { name: "운영진", color: "#b5e48c", count: 2 },
    ],
    meetups_30d: 8, attend_30d: 64, attenders_30d: 21, trained_30d: 18,
    unpaid_amount: 90000, unpaid_count: 3, waived_amount: 30000, unpaid_list: [],
  },
  race_percentile: 42,
  // 보드는 다크로 남는 화면이라 캡쳐로 꼭 확인해야 한다 — 최소 구조를 채워 둔다
  pft_race_board: {
    race: {
      id: uuid(1), code: "QT2S7L", title: "LOOP8 PFT 9월", status: "open",
      crew: "LOOP8", crew_slug: "loop8", created_at: "2026-09-01T00:00:00.000Z",
      join_open: true,
    },
    server_now: "2026-09-18T09:30:00.000Z",
    entries: NAMES.map((n, i) => ({
      entry_id: uuid(100 + i), user_id: uuid(200 + i), name: n,
      started_at: i < 4 ? "2026-09-18T09:20:00.000Z" : null,
      splits: i < 4 ? [62000, 145000, 228000].slice(0, i + 1) : [],
      finished_at: i < 2 ? "2026-09-18T09:28:00.000Z" : null,
      total_ms: i < 2 ? 480000 + i * 9000 : null,
      scaled: false, badge: i === 0 ? "gold" : null,
      wave: i < 4 ? 1 : null, dnf_at: null,
    })),
  },
  pft_race_my_entry: null,
  pft_race_split: null,
  pft_race_staff_split: null,
  program_calendar: null,
  run_1k_baseline: null,
  session_run_degradation: null,
};

const ok = <T,>(data: T, count: number | null = null) => ({ data, error: null, count });

/** 체이너블 쿼리 빌더. 필터는 전부 무시하고 자기 자신을 돌려준다. */
function builder(fixed?: { select?: string; rows?: number; value?: unknown }) {
  let select = fixed?.select ?? "*";
  let n = fixed?.rows ?? 6;
  let one = false;

  const b: Record<string, unknown> = {};
  const self = () => b;

  // 필터·수식어는 전부 no-op
  for (const m of [
    "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "or",
    "not", "contains", "overlaps", "filter", "match", "textSearch", "range",
    "abortSignal", "throwOnError", "returns", "overrideTypes", "order",
  ]) {
    b[m] = self;
  }

  b.select = (cols?: string, opts?: { head?: boolean; count?: string }) => {
    if (typeof cols === "string") select = cols;
    if (opts?.head) n = 0;
    return b;
  };
  b.limit = (v: number) => {
    n = Math.min(n, Math.max(v, 0));
    return b;
  };
  b.single = () => {
    one = true;
    return b;
  };
  b.maybeSingle = () => {
    one = true;
    return b;
  };
  b.insert = () => b;
  b.update = () => b;
  b.upsert = () => b;
  b.delete = () => b;
  b.csv = () => Promise.resolve(ok(""));

  const settle = () => {
    // maybeSingle()/single() 은 배열이 아니라 행 하나를 기대한다 — 고정값이
    // 목록이면 첫 행을 꺼내 준다(안 그러면 페이지가 []을 행으로 읽는다).
    if (fixed && "value" in fixed) {
      const v = fixed.value;
      return ok(one && Array.isArray(v) ? (v[0] ?? null) : v);
    }
    const rows = rowsFor(select, n);
    return ok(one ? (rows[0] ?? null) : rows, 3);
  };
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(settle()).then(res, rej);
  b.catch = (rej: (e: unknown) => unknown) => Promise.resolve(settle()).catch(rej);
  b.finally = (f: () => void) => Promise.resolve(settle()).finally(f);

  return b;
}

type CookieLike = { name: string; value: string };
type Options = { cookies?: { getAll?: () => CookieLike[] } };

function loggedOut(options?: Options): boolean {
  try {
    const all = options?.cookies?.getAll?.();
    if (all) return all.some((c) => c.name === "rox_fixture_auth" && c.value === "out");
    if (typeof document !== "undefined") {
      return document.cookie.includes("rox_fixture_auth=out");
    }
  } catch {
    /* 쿠키를 못 읽으면 로그인 상태로 본다 */
  }
  return false;
}

const FIXTURE_USER = {
  id: FIXTURE_USER_ID,
  email: "fixture@roxlogy.com",
  user_metadata: { full_name: "김초호", avatar_url: null },
  app_metadata: { provider: "email" },
  identities: [{ id: "1", provider: "google" }],
  created_at: "2026-01-01T00:00:00.000Z",
};

export function makeClient(options?: Options) {
  const out = loggedOut(options);
  const user = out ? null : FIXTURE_USER;
  const session = user ? { user, access_token: "fixture", expires_at: 9e9 } : null;

  return {
    from: () => builder(),
    rpc: (name: string) => {
      if (name in RPC_SCALARS) return builder({ value: RPC_SCALARS[name] });
      if (name in RPC_OBJECTS) {
        return builder({ value: rowsFor(RPC_OBJECTS[name], 1)[0] });
      }
      if (name in RPC_SHAPES) return builder({ select: RPC_SHAPES[name] });
      return builder({ value: [] });
    },
    schema: () => ({ from: () => builder(), rpc: () => builder({ value: [] }) }),
    auth: {
      getUser: async () => ok({ user }),
      getSession: async () => ok({ session }),
      getClaims: async () => ok(user ? { claims: { sub: user.id } } : null),
      getUserIdentities: async () => ok({ identities: FIXTURE_USER.identities }),
      signInWithPassword: async () => ok({ user, session }),
      signInWithOAuth: async () => ok({ url: "/dashboard", provider: "google" }),
      signInWithIdToken: async () => ok({ user, session }),
      signUp: async () => ok({ user, session }),
      signOut: async () => ({ error: null }),
      setSession: async () => ok({ user, session }),
      exchangeCodeForSession: async () => ok({ user, session }),
      linkIdentity: async () => ok({ url: "/settings/profile" }),
      unlinkIdentity: async () => ({ error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove: async () => ok([]),
        upload: async () => ok({ path: "fixture" }),
      }),
    },
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: (cb?: (s: string) => void) => {
          cb?.("SUBSCRIBED");
          return ch;
        },
        unsubscribe: async () => "ok",
      };
      return ch;
    },
    removeChannel: async () => "ok",
    getChannels: () => [],
  };
}
