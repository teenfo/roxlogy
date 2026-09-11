// 권한 회귀 프로브 — anon 키 + 전용 프로브 계정 2개(활성·정지)로 운영 PostgREST·GoTrue·
// 웹·MCP 엔드포인트를 두드려, "거부되어야 하는 것"이 지금도 거부되고 "되어야 하는 것"이
// 아직 되는지 단언한다 (감사 A09, 2026-09-11. 검토 라운드에서 익명 관점 → 역할별로 확장).
//
// 왜 이런 검사가 따로 필요한가
//   · 이 프로젝트의 권한 사고는 전부 "원래 막혀 있던 것이 뒤의 마이그레이션·배포에서
//     다시 열리는" 회귀였다 — enqueue_notification·_mcp_insert_workouts 가 익명 호출
//     가능했던 일(012·013), 비로그인 ICS 구독이 로그인 307 로 빠진 일(A04), 정지 전에
//     발급한 MCP 토큰이 계속 통한 일(A02), 재발급 버튼이 조용히 실패한 일(A01).
//   · 마이그레이션 안의 DO 블록 가드는 그 파일이 적용되는 순간만 지킨다. 이후 파일이
//     grant·정책·함수 본문을 덮어써도 아무도 모른다. 그래서 운영 DB·사이트를 바깥에서
//     매일 찔러 보는 검사가 필요하다(probe.yml 스케줄 + 수동 실행).
//   · 서비스 키를 쓰지 않는다. 역할별 검증은 **전용 프로브 계정 2개**의 이메일/비밀번호
//     로그인(GoTrue password grant, anon 키)으로 한다 — 실제 사용자와 같은 경로라 RLS·
//     pre-request 게이트·RPC grant 를 있는 그대로 통과한다. CI 시크릿에 서비스 키를
//     하나 더 두는 것 자체가 노출면이고, 실수로 들어오면 아래에서 거부하고 종료한다.
//   · 단언마다 어떤 회귀를 잡는지 주석으로 적고, 기대/실제를 항상 출력한다. 하나라도
//     어긋나면 exit 1. 네트워크 오류·시크릿 누락도 "안전함을 증명하지 못한 것"이므로
//     조용히 통과시키지 않고 exit 1 이다. 일부러 뺀 구간은 SKIP 으로 표시된다.
//
// 이 프로브가 전제하는 배포 상태 (엄격 — "미적용" 허용 없음)
//   체크아웃의 마이그레이션(특히 084 토큰 재발급·085 쓰기 범위·086 정지 강제)과 web/
//   (proxy.ts·calendar.ics route·api/mcp)이 운영에 그대로 배포돼 있다고 본다. 함수가
//   없어 404(PGRST202) 면 "아직 미적용" 이 아니라 FAIL 이다 — 검토 라운드에서 "미적용
//   으로 간주해 통과" 허용에 만료가 없어 적용 뒤 드롭·이름 변경 회귀를 놓친다는 지적을
//   받아 걷어냈다. 배포 직후 첫 실행이 빨간불이면 적용 순서를 확인할 것(의도된 보수적
//   실패). A04 웹 단언이 proxy.ts 배포를 전제하는 것과 같은 기준이다.
//
// 프로브 계정 (레포 시크릿, 운영자가 한 번 만든다 — 실제 사용자 계정을 쓰지 말 것)
//   PROBE_USER_EMAIL / PROBE_USER_PASSWORD         활성 일반 회원. 이메일 확인 완료,
//     관리자 아님, 어떤 크루의 운영진도 아님. 이 프로브가 매 실행 이 계정의 MCP 토큰을
//     재발급·폐기하고 '변경 허용' 스위치를 켰다 끄므로 다른 용도로 쓰지 말 것.
//     실행이 끝나면 토큰은 폐기(null)·스위치는 꺼짐 상태로 남는다.
//   PROBE_DISABLED_EMAIL / PROBE_DISABLED_PASSWORD 관리자가 정지(profiles.disabled=true)
//     시킨 계정. 이 계정에는 어떤 쓰기도 성공하면 안 되므로 프로브는 이 계정을 바꾸지
//     않는다 — 모든 쓰기 시도가 거부되는 것 자체가 단언이다.
//   PROBE_FOREIGN_CREW_SLUG (선택) 활성 프로브 계정이 운영진이 아닌 **실제** 크루의 slug.
//     "타 크루 운영진 도구 거부" 단언에 쓴다. 없으면 그 단언만 SKIP 으로 표시된다
//     (없는 slug 로는 '크루 없음'과 '운영진 아님'을 구분할 수 없어 기본값을 두지 않았다).
//
// 기대 상태코드의 근거 (PostgREST 오류 매핑)
//   · 42501 (permission denied / RLS with check 위반 / raise … errcode 42501)
//       → anon 역할이면 401, 로그인 역할이면 403
//   · P0001 (raise exception 'account_disabled' 처럼 errcode 없는 raise) → 400
//   · 23502/23514 (not null·check 위반) → 400. RLS with check 는 제약보다 먼저 평가되므로
//     "제약 위반까지 닿았다" = "RLS 와 게이트를 통과했다" 로 읽는다(행은 남지 않음).
//   · PGRST202 (함수 없음·인자 이름 불일치) → 404
//   운영 DB 의 grant 상태(2026-09-11 확인): enqueue_notification·_mcp_insert_workouts·
//   enqueue_wod_reminders 는 anon·authenticated 모두 execute 없음. program_calendar·
//   mcp_uid·mcp_rsvp·mcp_write_enabled 는 의도적으로 anon 허용(토큰이 곧 인증). 084·085
//   의 mcp_token_regen/revoke·mcp_set_write 는 authenticated 만. notifications·sessions·
//   crew_ledger 는 anon 에 테이블 권한이 있고(Supabase 기본) RLS 만이 방벽이다.
//
// 환경변수
//   SUPABASE_ANON_KEY (또는 NEXT_PUBLIC_SUPABASE_ANON_KEY) — 필수. 서비스 키 금지.
//   SUPABASE_URL   기본: 운영 프로젝트.   SITE_URL   기본: https://roxlogy.com
//   PROBE_SKIP_DB=1 / PROBE_SKIP_WEB=1 / PROBE_SKIP_ACCOUNTS=1 — 일부만 돌릴 때. SKIP 은
//     결과에 그대로 표시된다(조용한 통과 아님).
// 실행: node scripts/db-permission-probe.mjs   (Node 20+ — 내장 fetch)

const SUPABASE_URL = (
  process.env.SUPABASE_URL || "https://vuloxbpfhyqkvgmpmkst.supabase.co"
).replace(/\/+$/, "");
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const SITE_URL = (process.env.SITE_URL || "https://roxlogy.com").replace(
  /\/+$/,
  "",
);
const SKIP_DB = process.env.PROBE_SKIP_DB === "1";
const SKIP_WEB = process.env.PROBE_SKIP_WEB === "1";
const SKIP_ACCOUNTS = process.env.PROBE_SKIP_ACCOUNTS === "1";
const ACCOUNTS = {
  active: {
    email: process.env.PROBE_USER_EMAIL || "",
    password: process.env.PROBE_USER_PASSWORD || "",
  },
  disabled: {
    email: process.env.PROBE_DISABLED_EMAIL || "",
    password: process.env.PROBE_DISABLED_PASSWORD || "",
  },
};
const FOREIGN_CREW_SLUG = process.env.PROBE_FOREIGN_CREW_SLUG || "";
const TIMEOUT_MS = 20_000;

// 존재하지 않는 것이 확실한 id. RLS 가 뚫려도 FK(crews·profiles)에 걸려 아무 행도
// 남지 않으므로, 이 프로브는 회귀 상태에서도 운영 데이터를 바꾸지 않는다.
const NIL_UUID = "00000000-0000-4000-8000-000000000000";
// 존재할 수 없는 MCP 토큰. mcp_uid 는 24자 미만을 즉시 버리므로 길이를 채워 "토큰 비교
// 까지 갔는데 없다" 를 확인한다(짧은 문자열이면 비교 자체를 건너뛰어 검사가 공허해진다).
const BOGUS_TOKEN = "probe-token-that-does-not-exist-0000000000";

const MISSING_NOTE =
  "함수가 없다(404 PGRST202) — 마이그레이션 미적용이거나 드롭·이름 변경·인자 변경 회귀. " +
  "이 프로브는 체크아웃의 마이그레이션이 운영에 적용됐다고 전제한다(미적용 허용 없음)";

// ── 서비스 키 방어 ────────────────────────────────────────────────────────────
// 시크릿 이름을 잘못 연결해 서비스 키가 들어오면 모든 "거부" 단언이 거짓으로 실패하는
// 데서 그치지 않고, 이 스크립트가 RLS 를 우회해 crew_ledger·sessions 에 실제로 insert 를
// 시도하게 된다. 키 모양에서 역할을 읽어 anon 이 아니면 아예 시작하지 않는다.
function refuseNonAnonKey(key) {
  if (!key) return;
  if (key.startsWith("sb_secret_")) {
    fail_hard("SUPABASE_ANON_KEY 에 secret 키(sb_secret_…)가 들어왔다 — anon/publishable 키만 허용");
  }
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      );
      if (payload?.role && payload.role !== "anon") {
        fail_hard(
          `SUPABASE_ANON_KEY 의 JWT role 이 '${payload.role}' 이다 — anon 키만 허용`,
        );
      }
    } catch (e) {
      if (e?.__hard) throw e;
      // JWT 가 아니면(publishable 키 등) 역할을 읽을 수 없다 — PostgREST 가 판정한다.
    }
  }
}
function fail_hard(msg) {
  const e = new Error(msg);
  e.__hard = true;
  throw e;
}

// ── HTTP 공통 ────────────────────────────────────────────────────────────────
// redirect: "manual" — 로그인 307 을 '따라가서 200' 으로 읽으면 A04 회귀를 못 본다.
async function http(url, { method = "GET", headers = {}, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": "roxlogy-permission-probe/1", ...headers },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, location: res.headers.get("location"), text, json };
  } catch (e) {
    return {
      status: 0,
      error: e?.cause?.code || e?.name || String(e),
      location: null,
      text: "",
      json: undefined,
    };
  }
}

const trunc = (s, n = 90) => (s.length > n ? s.slice(0, n) + "…" : s);
function describe(r) {
  if (r.status === 0) return `네트워크 오류 (${r.error})`;
  let s = `HTTP ${r.status}`;
  if (r.location) s += ` → ${r.location}`;
  if (r.json && typeof r.json === "object" && !Array.isArray(r.json)) {
    if (r.json.code) s += ` code=${r.json.code}`;
    if (r.json.error_code) s += ` error_code=${r.json.error_code}`;
    if (r.json.message) s += ` "${trunc(String(r.json.message))}"`;
    else if (r.json.msg) s += ` "${trunc(String(r.json.msg))}"`;
    else if (r.json.error) s += ` error=${trunc(String(r.json.error), 60)}`;
    else if (!r.json.code) s += ` body=${trunc(JSON.stringify(r.json), 80)}`;
  } else if (Array.isArray(r.json)) {
    s += ` rows=${r.json.length}`;
  } else if (r.text) {
    // 토큰 같은 비밀값이 로그에 남지 않도록 64자 hex 는 가린다.
    const t = r.text.replace(/\s+/g, " ");
    s += ` body=${/^"[0-9a-f]{64}"$/.test(t) ? '"<64자 hex>"' : trunc(t, 60)}`;
  } else {
    s += " (빈 본문)";
  }
  return s;
}

// ── 결과 수집 ────────────────────────────────────────────────────────────────
const results = [];
function record(name, ok, expected, actual, note) {
  results.push({ name, ok, expected, actual, note });
  const tag = ok === null ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}`);
  console.log(`       기대: ${expected}`);
  console.log(`       실제: ${actual}`);
  if (note) console.log(`       메모: ${note}`);
}
const skip = (name, why) => record(name, null, "-", "-", why);

// ── PostgREST 공통 ───────────────────────────────────────────────────────────
const rest = (path) => `${SUPABASE_URL}/rest/v1/${path}`;
// jwt 가 없으면 anon 역할, 있으면 그 사용자(authenticated) — apikey 는 항상 anon 키.
const authHeaders = (jwt) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${jwt || ANON_KEY}`,
});
const rpc = (name, args, jwt) =>
  http(rest(`rpc/${name}`), {
    method: "POST",
    headers: { ...authHeaders(jwt), "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });

const isDenied = (r) =>
  (r.status === 401 || r.status === 403) && r.json?.code === "42501";
const isMissingFn = (r) => r.status === 404 && r.json?.code === "PGRST202";
// 스칼라 null 응답 — PostgREST 는 본문 `null` 을 준다(빈 본문도 같은 뜻으로 받는다).
const isNullBody = (r) =>
  r.status === 200 && (r.text.trim() === "" || r.text.trim() === "null");
const isHexToken = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
// 정지 계정 거부는 두 층 중 어디서 막혀도 된다: 086 pre-request 게이트·트리거(42501→403)
// 또는 084/085 함수 본문의 raise 'account_disabled'(P0001→400). 2xx 만 아니면 되지만
// "예상 밖 응답"과는 구분한다.
const isDisabledDenied = (r) =>
  isDenied(r) ||
  (r.status === 400 && /account_disabled/.test(r.json?.message ?? r.text));

// ── 익명(anon) 단언 ──────────────────────────────────────────────────────────

/**
 * 호출자 검증이 없는 SECURITY DEFINER 헬퍼(또는 본인 JWT 전용 RPC)는 anon 이 실행하지
 * 못해야 한다. 잡는 회귀: 어떤 마이그레이션이 이 함수를 create or replace 하면서
 * grant execute … to anon 을 붙임(또는 revoke 를 빠뜨림). 2xx 가 나오면 익명이 알림을
 * 인큐하거나 남의 프로그램에 운동을 꽂거나 토큰을 재발급할 수 있다는 뜻이다.
 *
 * 인자는 실제 시그니처의 이름을 그대로 보낸다 — 인자 이름이 틀리면 PostgREST 가
 * 함수를 못 찾아 404 를 주는데, 그 404 를 "거부됐다"로 읽으면 안 되기 때문이다.
 */
async function assertRpcDenied(name, args, why) {
  const r = await rpc(name, args);
  const ok = isDenied(r);
  record(
    `rpc ${name}: anon 호출 거부`,
    ok,
    "401/403 + code 42501",
    describe(r),
    ok
      ? undefined
      : isMissingFn(r)
        ? MISSING_NOTE
        : r.status >= 200 && r.status < 300
          ? `익명이 실행했다 — ${why}`
          : "예상 밖 응답",
  );
}

/**
 * is_account_active() 는 예외 — 086 이 anon·authenticated 에 execute 를 준다. 쓰기 RLS
 * 정책식이 (select is_account_active()) 로 호출하므로 거부되면 정책 평가 자체가
 * permission denied 로 죽는다. 대신 "JWT 없는 호출은 반드시 false" 여야 한다.
 * 잡는 회귀: (a) true → 익명을 활성 계정으로 봐 정지 강제가 무의미해짐,
 *            (b) 401/403 → grant 가 빠져 anon 경로의 모든 쓰기 RLS 가 에러로 죽음,
 *            (c) 404 → 함수가 드롭됐거나 086 미적용 — 정책이 참조하므로 즉시 장애.
 */
async function assertIsAccountActiveFalse() {
  const r = await rpc("is_account_active", {});
  let ok;
  let note;
  if (r.status === 200 && r.json === false) {
    ok = true;
  } else if (r.status === 200) {
    ok = false;
    note = "JWT 없는 호출이 false 가 아니다 — 익명을 활성 계정으로 판정";
  } else if (r.status === 401 || r.status === 403) {
    ok = false;
    note = "anon 에 execute 가 없다 — RLS 정책식에서 호출되므로 정책 평가가 죽는다";
  } else if (isMissingFn(r)) {
    ok = false;
    note = MISSING_NOTE;
  } else {
    ok = false;
    note = "예상 밖 응답";
  }
  record(
    "rpc is_account_active: 익명 → false",
    ok,
    "200 + body false",
    describe(r),
    note,
  );
}

/**
 * mcp_write_enabled(p_token) 은 route 가 쓰는 얇은 조회(085, anon 허용) — 무효 토큰이면
 * null, 읽기 전용이면 false, 쓰기 허용이면 true. 토큰의 생사·범위를 anon 키로 확인할
 * 수 있는 유일한 창구라 A01·A03 단언의 기본 도구다. 잡는 회귀: 토큰 비교가 사라져
 * 아무 토큰에 값이 나옴, 정지 계정 토큰이 살아 있음, grant 회수로 route 가 죽음.
 */
async function assertWriteEnabled(label, token, expected, why) {
  const r = await rpc("mcp_write_enabled", { p_token: token });
  const value =
    r.status !== 200 ? undefined : isNullBody(r) ? null : r.json;
  const ok = r.status === 200 && value === expected;
  record(
    `rpc mcp_write_enabled: ${label} → ${String(expected)}`,
    ok,
    `200 + ${String(expected)}`,
    describe(r),
    ok
      ? undefined
      : isMissingFn(r)
        ? MISSING_NOTE
        : isDenied(r)
          ? "anon 에 execute 가 없다 — /api/mcp 의 읽기 전용 안내가 죽는다"
          : why,
  );
}

/**
 * program_calendar(p_id, p_token) 은 의도적으로 anon 허용(캘린더 구독 fetch) — 대신
 * 토큰이 맞지 않으면 null 이어야 한다. A04(비로그인 ICS)의 DB 쪽 절반.
 * 잡는 회귀: 토큰 비교가 빠지거나 느슨해져 아무 토큰으로 일정 JSON 이 나옴(2xx + 객체),
 * 또는 grant 가 회수돼 구독 자체가 깨짐(401/403).
 */
async function assertProgramCalendarNullOnBadToken() {
  const r = await rpc("program_calendar", { p_id: NIL_UUID, p_token: "x" });
  const empty =
    r.json == null || (Array.isArray(r.json) && r.json.length === 0);
  const ok = r.status === 200 && empty;
  record(
    "rpc program_calendar: 없는 프로그램 + 엉뚱한 토큰 → null",
    ok,
    "200 + null",
    describe(r),
    ok
      ? undefined
      : r.status === 200
        ? "토큰 검증 없이 데이터가 나왔다"
        : r.status === 401 || r.status === 403
          ? "anon execute 가 회수됐다 — 캘린더 구독이 전부 깨진다"
          : "예상 밖 응답",
  );
}

/**
 * 익명 select 는 0행(RLS)이거나 아예 거부여야 한다.
 * 잡는 회귀: select 정책이 `using (true)` 로 바뀌거나 OR 분기가 잘못 합쳐져 익명에게
 * 행이 새는 것. (정책 통합 027 처럼 여러 정책을 하나로 합치는 작업에서 생기기 쉽다.)
 */
async function assertAnonSelectEmpty(name, query, why) {
  const r = await http(rest(query), { headers: authHeaders() });
  const emptyOk = r.status === 200 && Array.isArray(r.json) && r.json.length === 0;
  const denied = r.status === 401 || r.status === 403;
  const ok = emptyOk || denied;
  record(
    name,
    ok,
    "200 + rows=0 (또는 401/403)",
    describe(r),
    ok ? undefined : r.status === 200 ? why : "예상 밖 응답",
  );
}

/**
 * crew_ledger 익명 insert 는 RLS with check 에서 막혀야 한다(→ 42501).
 * 본문은 컬럼·check 제약을 모두 만족하도록 만든다 — 형식이 틀리면 RLS 에 닿기 전에
 * 400 이 나와 회귀를 가린다. crew_id 는 없는 uuid 라 RLS 가 뚫려도 FK 로 실패하고,
 * 그때는 409(23503)가 나온다: 즉 401/403+42501 이 아닌 모든 응답은 "정책이 막지
 * 않았다"는 뜻이다.
 * 잡는 회귀: insert 정책 with check 가 느슨해짐(is_crew_staff 조건 소실 등).
 */
async function assertCrewLedgerAnonInsertDenied() {
  const r = await http(rest("crew_ledger"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      crew_id: NIL_UUID,
      kind: "expense",
      amount: 1,
      title: "permission-probe",
    }),
  });
  const ok = isDenied(r);
  record(
    "table crew_ledger: anon insert 거부",
    ok,
    "401/403 + code 42501",
    describe(r),
    ok
      ? undefined
      : r.status === 409 || r.json?.code === "23503"
        ? "RLS 를 지나 FK 단계까지 닿았다 — 익명 insert 를 정책이 막지 않음"
        : r.status >= 200 && r.status < 300
          ? "익명 insert 가 성공했다"
          : "예상 밖 응답 (본문 형식이 스키마와 어긋났으면 프로브를 갱신할 것)",
  );
}

async function anonAssertions() {
  // 내부 헬퍼 — 012·013 에서 실제로 익명에게 열려 있던 함수들.
  await assertRpcDenied(
    "enqueue_notification",
    { p_user_id: NIL_UUID, p_type_key: "probe", p_title: "probe", p_body: "probe", p_url: "/" },
    "익명이 아무 사용자에게 알림을 인큐할 수 있다(grant execute 회귀)",
  );
  await assertRpcDenied(
    "_mcp_insert_workouts",
    { p_day_id: NIL_UUID, p_workouts: [] },
    "익명이 남의 프로그램 일차에 운동을 꽂을 수 있다(grant execute 회귀)",
  );
  await assertRpcDenied("enqueue_wod_reminders", {}, "익명이 WOD 알림 크론을 돌릴 수 있다");
  // 085 의 내부 게이트 — grant 가 붙으면 토큰만으로 쓰기 범위를 캐묻는 창구가 된다.
  await assertRpcDenied(
    "mcp_can_write",
    { p_token: BOGUS_TOKEN },
    "내부 게이트 mcp_can_write 에 anon execute 가 붙었다(085 는 revoke 만 한다)",
  );
  // 084·085 의 본인 JWT 전용 RPC — anon 은 auth_required 이전에 grant 에서 막혀야 한다.
  await assertRpcDenied("mcp_token_regen", {}, "익명이 토큰 재발급 RPC 를 실행했다(authenticated 전용, A01)");
  await assertRpcDenied("mcp_token_revoke", {}, "익명이 토큰 폐기 RPC 를 실행했다(authenticated 전용, A01)");
  await assertRpcDenied("mcp_set_write", { p_on: false }, "익명이 쓰기 범위 스위치를 실행했다(authenticated 전용, A03)");
  await assertIsAccountActiveFalse();
  await assertWriteEnabled(
    "존재하지 않는 토큰",
    BOGUS_TOKEN,
    null,
    "없는 토큰에 값이 나왔다 — mcp_uid 의 토큰 비교가 사라졌거나 느슨해짐",
  );
  await assertProgramCalendarNullOnBadToken();
  await assertAnonSelectEmpty(
    "table notifications: anon select 0행",
    "notifications?select=id&limit=5",
    "남의 알림이 익명에게 보인다 — notif_select_own 회귀",
  );
  // shared=true 세션은 피드용으로 익명에게도 열려 있다(sessions_select). 그래서
  // 전체가 아니라 "비공유"와 "soft delete 된 것"이 0행인지 본다.
  await assertAnonSelectEmpty(
    "table sessions: 비공유 세션 anon select 0행",
    "sessions?select=id&shared=eq.false&limit=5",
    "비공유 세션이 익명에게 보인다 — sessions_select 의 shared 조건 회귀",
  );
  await assertAnonSelectEmpty(
    "table sessions: soft delete 세션 anon select 0행",
    "sessions?select=id&deleted_at=not.is.null&limit=5",
    "삭제된 세션이 익명에게 보인다 — sessions_select 의 deleted_at 조건 회귀",
  );
  // profiles_select 는 본인·관리자만이다(2026-09-11 확인). anon 이 mcp_token 컬럼을
  // 한 줄이라도 읽으면 A01(토큰 회수)이 통째로 무의미해지므로 별도로 본다.
  await assertAnonSelectEmpty(
    "table profiles: anon select mcp_token 0행",
    "profiles?select=id,mcp_token&limit=5",
    "프로필(과 MCP 토큰)이 익명에게 보인다 — profiles_select 가 공개로 풀렸거나 컬럼 노출",
  );
  await assertCrewLedgerAnonInsertDenied();
}

// ── GoTrue 로그인 ────────────────────────────────────────────────────────────
// 실제 사용자와 같은 password grant. 반환 JWT 로 PostgREST 를 부르면 authenticated 역할
// + auth.uid() 가 그 사용자다 — RLS·pre-request 게이트·RPC grant 가 그대로 적용된다.
async function login(email, password) {
  const r = await http(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const jwt = r.json?.access_token;
  const uid = r.json?.user?.id;
  return {
    r,
    jwt: typeof jwt === "string" ? jwt : null,
    uid: typeof uid === "string" ? uid : null,
  };
}
// 로그인 응답은 access/refresh 토큰을 담고 있어 describe() 로 본문을 찍으면 CI 로그에
// JWT 가 남는다. 상태와 "토큰이 있었는지"만 기록한다.
function describeAuth(L) {
  const r = L.r;
  if (r.status === 0) return describe(r);
  if (r.status === 200) {
    return `HTTP 200 access_token=${L.jwt ? "(있음)" : "(없음)"} user.id=${L.uid ? "(있음)" : "(없음)"}`;
  }
  let s = `HTTP ${r.status}`;
  if (r.json?.error_code) s += ` error_code=${r.json.error_code}`;
  if (r.json?.msg) s += ` "${trunc(String(r.json.msg), 60)}"`;
  else if (r.json?.error_description) s += ` "${trunc(String(r.json.error_description), 60)}"`;
  return s;
}
// 프로브가 만든 Auth 세션을 정리한다 — 특히 정지 계정에 살아 있는 리프레시 토큰을 남기지
// 않기 위해서다. 실패해도 단언에는 영향 없다(best-effort).
async function logout(jwt) {
  if (!jwt) return;
  await http(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
}

/**
 * sessions insert 로 "쓰기 RLS + pre-request 게이트"를 한 번에 본다.
 * 본문 {user_id: 본인, source_device:'probe'} 는 sessions_insert_own 의 user_id 조건을
 * 만족해 RLS 를 통과하지만, id 가 없어(not null·default 없음) 그 직후 제약 단계에서
 * 23502 로 죽는다 — RLS with check 는 제약보다 먼저 평가되므로 400+23502/23514 는
 * "정책과 게이트가 통과시켰다"는 증거이고, 어떤 상태에서도 행은 남지 않는다.
 *   활성 계정(expectDenied=false): 반드시 제약까지 닿아야 한다. 잡는 회귀:
 *     is_account_active() 가 활성 계정에 false 를 주거나 게이트가 오판해 전체 쓰기가
 *     죽는 것(정지 단언이 공허하지 않음을 증명하는 대조군이기도 하다).
 *   정지 계정(expectDenied=true): 42501 이어야 한다(게이트 403 또는 RLS 403).
 *     잡는 회귀: 086 의 `and (select is_account_active())` 조건이 정책에서 빠지고
 *     pre-request 게이트도 풀림(A02).
 */
async function assertSessionsInsert(label, jwt, uid, expectDenied) {
  const r = await http(rest("sessions"), {
    method: "POST",
    headers: {
      ...authHeaders(jwt),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ user_id: uid, source_device: "probe" }),
  });
  const reachedConstraints =
    r.status === 400 && ["23502", "23514"].includes(r.json?.code);
  const denied = isDenied(r);
  const ok = expectDenied ? denied : reachedConstraints;
  let note;
  if (!ok) {
    if (expectDenied) {
      note = reachedConstraints
        ? "정지 계정의 insert 가 RLS 와 pre-request 게이트를 모두 지나 제약까지 닿았다 — is_account_active 조건·게이트 회귀(A02)"
        : r.status >= 200 && r.status < 300
          ? "정지 계정 insert 가 성공했다(행이 생겼다) — 즉시 확인할 것"
          : "예상 밖 응답";
    } else {
      note = denied
        ? "활성 계정의 insert 가 42501 로 막혔다 — is_account_active 가 활성 계정에 false 이거나 게이트 오판(전체 쓰기 장애)"
        : r.status >= 200 && r.status < 300
          ? "제약 위반이어야 할 본문이 들어갔다 — 스키마가 바뀌었으니 프로브를 갱신하고 생긴 행을 지울 것"
          : "예상 밖 응답";
    }
  }
  record(
    `table sessions: ${label} 계정 insert → ${expectDenied ? "거부" : "RLS·게이트 통과(제약에서 정지)"}`,
    ok,
    expectDenied
      ? "401/403 + code 42501"
      : "400 + code 23502/23514 (행은 남지 않음)",
    describe(r),
    note,
  );
}

// ── MCP route (/api/mcp, Streamable HTTP · 무상태) ──────────────────────────
// mcp-handler 는 legacy:'stateless' 라 initialize 없이 tools/call 한 번이면 된다.
// 프로토콜 버전 헤더를 보내지 않으면 2025 세대(무상태)로 분류된다. 응답은 SSE(기본)
// 또는 JSON — 둘 다 받는다. 도구 결과는 content[0].text 안의 JSON 문자열이다.
async function mcpToolCall(token, name, args) {
  const r = await http(`${SITE_URL}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  let msg =
    r.json && typeof r.json === "object" && !Array.isArray(r.json)
      ? r.json
      : undefined;
  if (!msg && r.text) {
    for (const line of r.text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j && (j.result || j.error)) {
          msg = j;
          break;
        }
      } catch {
        // SSE 주석·keep-alive 줄은 건너뛴다
      }
    }
  }
  let payload;
  const text = msg?.result?.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { ...r, msg, payload };
}
function describeMcp(x) {
  if (x.status === 0) return describe(x);
  let s = `HTTP ${x.status}`;
  if (x.msg?.error) s += ` rpc-error=${trunc(JSON.stringify(x.msg.error), 80)}`;
  if (x.payload !== undefined) {
    s += ` payload=${trunc(JSON.stringify(x.payload), 90)}`;
  } else if (!x.msg) {
    s += ` body=${trunc(x.text.replace(/\s+/g, " "), 70)}`;
  }
  return s;
}
async function assertMcpTool(name, token, tool, args, check, why) {
  const x = await mcpToolCall(token, tool, args);
  const ok = x.status === 200 && check(x.payload);
  record(
    name,
    ok,
    "200 + 도구 응답이 조건을 만족",
    describeMcp(x),
    ok
      ? undefined
      : x.status === 401
        ? "route 가 토큰을 거부했다(401) — withMcpAuth 조건이 바뀌었나"
        : why,
  );
}

// ── 활성 프로브 계정(일반 회원) 흐름 — A01·A03 + A02 대조군 ───────────────────
async function activeAccountFlow() {
  const L = await login(ACCOUNTS.active.email, ACCOUNTS.active.password);
  const okLogin = L.r.status === 200 && !!L.jwt && !!L.uid;
  record(
    "auth 활성 프로브 계정 로그인",
    okLogin,
    "200 + access_token",
    describeAuth(L),
    okLogin
      ? undefined
      : "픽스처 문제(비밀번호·이메일 확인)이거나 GoTrue 장애 — 활성 계정 단언은 모두 SKIP",
  );
  if (!okLogin) {
    skip("활성 계정 단언(토큰 재발급·범위·쓰기 대조군·MCP route)", "로그인 실패");
    return;
  }
  const { jwt, uid } = L;
  try {
    // 픽스처 확인 — 관리자면 is_admin() OR 분기 때문에 '거부' 단언이 공허해지고, 정지돼
    // 있으면 아래가 전부 거부돼 회귀와 픽스처 문제를 구분할 수 없다.
    const P = await http(
      rest(`profiles?id=eq.${uid}&select=id,disabled,is_admin,mcp_write`),
      { headers: authHeaders(jwt) },
    );
    const prof = Array.isArray(P.json) ? P.json[0] : undefined;
    const okProf =
      P.status === 200 && !!prof && prof.disabled === false && prof.is_admin === false;
    record(
      "fixture 활성 계정: 본인 프로필 disabled=false, is_admin=false",
      okProf,
      "200 + 1행 (disabled=false, is_admin=false)",
      describe(P) +
        (prof ? ` disabled=${prof.disabled} is_admin=${prof.is_admin} mcp_write=${prof.mcp_write}` : ""),
      okProf
        ? undefined
        : P.status === 400
          ? "컬럼이 없다(mcp_write?) — 085 미적용"
          : "픽스처가 어긋났다(정지됐거나 관리자이거나 프로필 없음) — 프로브 계정을 확인할 것",
    );
    if (!okProf) {
      skip("활성 계정 단언(토큰 재발급·범위·쓰기 대조군·MCP route)", "픽스처 불일치");
      return;
    }

    // 1) 범위를 읽기 전용으로 고정한다(085 mcp_set_write). 이후 단언의 전제.
    const S0 = await rpc("mcp_set_write", { p_on: false }, jwt);
    const okS0 = S0.status === 200 && S0.json === false;
    record(
      "rpc mcp_set_write(false): 본인 JWT → 읽기 전용으로 설정",
      okS0,
      "200 + false",
      describe(S0),
      okS0
        ? undefined
        : isMissingFn(S0)
          ? MISSING_NOTE
          : isDenied(S0)
            ? "authenticated 에 execute 가 없다 — 설정 화면의 '변경 허용' 스위치가 죽는다"
            : "예상 밖 응답",
    );

    // 2) 재발급 #1 (084). 잡는 회귀: grant 누락·가드 충돌로 재발급이 죽어 사용자가
    //    유출 토큰을 스스로 회수하지 못하는 상태(A01 의 원래 증상).
    const R1 = await rpc("mcp_token_regen", {}, jwt);
    const t1 = isHexToken(R1.json) ? R1.json : null;
    record(
      "rpc mcp_token_regen: 본인 JWT → 새 토큰(64자 hex)",
      !!t1,
      "200 + 64자 hex 문자열",
      describe(R1),
      t1
        ? undefined
        : isMissingFn(R1)
          ? MISSING_NOTE
          : isDenied(R1)
            ? "authenticated 에 execute 가 없다 — 사용자가 토큰을 회수하지 못한다(A01)"
            : "예상 밖 응답 (profile_token_locked 면 084 의 bypass 가 깨진 것)",
    );
    if (!t1) {
      skip("토큰 회수·범위 단언(A01·A03)", "재발급 실패");
      await assertSessionsInsert("활성", jwt, uid, false);
      return;
    }
    // 새 토큰은 유효하고 읽기 전용이어야 한다(null 이면 토큰이 안 붙은 것, true 면 기본
    // 쓰기 허용 회귀 — 085 의 "기본 읽기 전용" 약속).
    await assertWriteEnabled(
      "재발급 직후 토큰(T1)",
      t1,
      false,
      "재발급 직후 토큰이 무효(null)이거나 쓰기 허용(true)이다 — 재발급 저장 실패 또는 기본 읽기 전용 회귀(A03)",
    );

    // 3) 재발급 #2 → 옛 토큰(T1)은 즉시 죽어야 한다. A01 완료 기준 그 자체.
    const R2 = await rpc("mcp_token_regen", {}, jwt);
    const t2 = isHexToken(R2.json) ? R2.json : null;
    const okR2 = !!t2 && t2 !== t1;
    record(
      "rpc mcp_token_regen: 두 번째 재발급 → T1 과 다른 토큰",
      okR2,
      "200 + T1 과 다른 64자 hex",
      describe(R2) + (t2 && t2 === t1 ? " (T1 과 동일)" : ""),
      okR2 ? undefined : t2 ? "같은 토큰이 다시 나왔다 — 난수 생성 회귀" : "예상 밖 응답",
    );
    if (!t2) {
      skip("토큰 회수·범위 단언(A01·A03)", "두 번째 재발급 실패");
      await assertSessionsInsert("활성", jwt, uid, false);
      return;
    }
    await assertWriteEnabled(
      "재발급 전 토큰(T1)",
      t1,
      null,
      "옛 토큰이 재발급 뒤에도 사용자에 매치된다 — 토큰 회수 실패(A01 회귀)",
    );
    await assertWriteEnabled(
      "현재 토큰(T2)",
      t2,
      false,
      "현재 토큰이 무효이거나 쓰기 허용이다 — 재발급 저장 실패 또는 기본 읽기 전용 회귀",
    );

    // 4) 읽기 전용 토큰의 쓰기 RPC — DB 게이트 직접 호출(A03). route 의 writeRpc 는 null 을
    //    받으면 mcp_write_enabled 로 보정해 read_only_token 을 만들어 주므로, route 만 봐서는
    //    DB 게이트(mcp_can_write 검사) 소실을 못 본다. 그래서 RPC 를 직접 부른다.
    //    p_event 는 없는 uuid 라 게이트가 없어도 이벤트 조회에서 null — 데이터 변경 없음.
    const V1 = await rpc("mcp_rsvp", { p_token: t2, p_event: NIL_UUID, p_status: "going" });
    const okV1 = V1.status === 200 && V1.json?.error === "read_only_token";
    record(
      "rpc mcp_rsvp: 읽기 전용 토큰 → {error:'read_only_token'}",
      okV1,
      "200 + {error:'read_only_token'}",
      describe(V1),
      okV1
        ? undefined
        : isNullBody(V1)
          ? "게이트 없이 이벤트 조회까지 갔다(null) — mcp_can_write 검사 소실(A03 회귀)"
          : isMissingFn(V1)
            ? MISSING_NOTE
            : "예상 밖 응답",
    );

    // 5) 스위치를 켜면 같은 호출이 게이트를 지나야 한다(없는 이벤트라 null). 잡는 회귀:
    //    mcp_set_write 가 저장을 안 하거나 mcp_can_write 가 항상 false — 쓰기 도구 전멸.
    //    이 대조군이 없으면 4) 는 "항상 read_only_token" 인 고장난 상태에서도 통과한다.
    const S1 = await rpc("mcp_set_write", { p_on: true }, jwt);
    const V2 = await rpc("mcp_rsvp", { p_token: t2, p_event: NIL_UUID, p_status: "going" });
    const okV2 = S1.status === 200 && S1.json === true && isNullBody(V2);
    record(
      "rpc mcp_rsvp: 변경 허용 토큰 → 게이트 통과(없는 이벤트 → null)",
      okV2,
      "set_write 200 + true, rsvp 200 + null",
      `set_write: ${describe(S1)} / rsvp: ${describe(V2)}`,
      okV2
        ? undefined
        : V2.json?.error === "read_only_token"
          ? "스위치를 켰는데도 읽기 전용 — mcp_set_write 가 저장하지 않거나 mcp_can_write 가 항상 false(쓰기 도구 전멸)"
          : "예상 밖 응답",
    );
    // 반드시 되돌린다 — 프로브 계정이 쓰기 허용으로 남으면 그 자체가 위험이다.
    const S2 = await rpc("mcp_set_write", { p_on: false }, jwt);
    const okS2 = S2.status === 200 && S2.json === false;
    record(
      "rpc mcp_set_write(false): 프로브 계정을 다시 읽기 전용으로",
      okS2,
      "200 + false",
      describe(S2),
      okS2 ? undefined : "프로브 계정이 쓰기 허용 상태로 남았다 — 설정 화면에서 수동으로 끌 것",
    );

    // 6) 활성 계정의 테이블 쓰기는 RLS·게이트를 지나야 한다(정지 단언의 대조군).
    await assertSessionsInsert("활성", jwt, uid, false);

    // 7) /api/mcp — 사용자가 실제로 쓰는 경로에서 같은 것을 본다(폐기 전에).
    if (SKIP_WEB) {
      skip("MCP route 단언(T1 거부·T2 허용·읽기 전용 쓰기 거부·타 크루)", "PROBE_SKIP_WEB=1");
    } else {
      await assertMcpTool(
        "MCP get_profile: 재발급 전 토큰(T1) → not_found_or_invalid_token",
        t1,
        "get_profile",
        {},
        (p) => p?.error === "not_found_or_invalid_token",
        "옛 토큰으로 프로필이 나왔다 — route 경로에서 토큰 회수 실패(A01)",
      );
      await assertMcpTool(
        "MCP get_profile: 현재 토큰(T2) → 프로필",
        t2,
        "get_profile",
        {},
        (p) => !!p && typeof p === "object" && !p.error && Array.isArray(p.crews),
        "유효한 토큰이 거부됐다 — route·mcp_profile 회귀(위 '거부' 단언들이 공허해진다)",
      );
      await assertMcpTool(
        "MCP rsvp_meetup: 읽기 전용 토큰 → read_only_token",
        t2,
        "rsvp_meetup",
        { event_id: NIL_UUID, status: "going" },
        (p) => p?.error === "read_only_token",
        "읽기 전용 토큰의 쓰기 도구가 read_only_token 을 주지 않는다 — route writeRpc·DB 게이트 둘 다 소실(A03)",
      );
      if (FOREIGN_CREW_SLUG) {
        // 타 크루(비운영진) 구분 — 감사 권고의 '운영진·타 크루 사용자 구분'. 운영진 조회
        // RPC 는 mcp_staff_crew_ro 로 크루를 얻으므로 비운영진이면 null → 도구는
        // not_found_or_invalid_token. 잡는 회귀: role 조건 소실로 남의 크루 대기자가 보임.
        await assertMcpTool(
          `MCP list_pending_members: 비운영진 토큰 + 타 크루(${FOREIGN_CREW_SLUG}) → not_found_or_invalid_token`,
          t2,
          "list_pending_members",
          { slug: FOREIGN_CREW_SLUG },
          (p) => p?.error === "not_found_or_invalid_token",
          "운영진이 아닌데 타 크루 대기자 목록이 나왔다 — mcp_staff_crew_ro 의 role 조건 회귀",
        );
      } else {
        skip("MCP 타 크루 운영진 도구 거부", "PROBE_FOREIGN_CREW_SLUG 미설정(선택 항목)");
      }
    }
    if (FOREIGN_CREW_SLUG) {
      const F = await rpc("mcp_pending_members", { p_token: t2, p_slug: FOREIGN_CREW_SLUG });
      const okF = isNullBody(F);
      record(
        `rpc mcp_pending_members: 비운영진 토큰 + 타 크루(${FOREIGN_CREW_SLUG}) → null`,
        okF,
        "200 + null",
        describe(F),
        okF ? undefined : isMissingFn(F) ? MISSING_NOTE : "운영진이 아닌데 타 크루 대기자가 나왔다 — mcp_staff_crew_ro 회귀",
      );
    }

    // 8) 폐기(084 mcp_token_revoke) → T2 도 죽는다. 재발급과 다른 코드 경로라 따로 본다.
    const K = await rpc("mcp_token_revoke", {}, jwt);
    const okK = K.status === 200 && K.json === true;
    record(
      "rpc mcp_token_revoke: 본인 JWT → 폐기",
      okK,
      "200 + true",
      describe(K),
      okK ? undefined : isMissingFn(K) ? MISSING_NOTE : isDenied(K) ? "authenticated 에 execute 가 없다 — 연결 끊기가 죽는다(A01)" : "예상 밖 응답",
    );
    await assertWriteEnabled(
      "폐기된 토큰(T2)",
      t2,
      null,
      "폐기 뒤에도 토큰이 사용자에 매치된다 — mcp_token_revoke 가 null 로 지우지 않음(A01 회귀)",
    );
    if (!SKIP_WEB) {
      await assertMcpTool(
        "MCP get_profile: 폐기된 토큰(T2) → not_found_or_invalid_token",
        t2,
        "get_profile",
        {},
        (p) => p?.error === "not_found_or_invalid_token",
        "폐기된 토큰으로 프로필이 나왔다 — route 경로에서 폐기가 무효(A01)",
      );
    }
  } finally {
    await logout(jwt);
  }
}

// ── 정지 프로브 계정 흐름 — A02 ──────────────────────────────────────────────
// 정지 직후에도 access JWT 는 만료까지 서명이 유효하고, 086 은 로그인 자체를 막지 않는다
// (auth.sessions 만 지운다). 그래서 정지 계정이 새로 로그인해 JWT 를 얻는 것은 정상이며,
// 그 JWT 로 "쓰기가 전부 거부되는가"가 A02 의 완료 기준이다. 만약 앞으로 GoTrue 단에서
// 로그인 자체를 막게 되면(banned) 그건 더 강한 차단이므로 PASS 로 기록하고 JWT 단언은
// SKIP 한다.
async function disabledAccountFlow() {
  const L = await login(ACCOUNTS.disabled.email, ACCOUNTS.disabled.password);
  if (L.r.status === 0) {
    record("auth 정지 프로브 계정 로그인", false, "200 또는 4xx", describeAuth(L), "네트워크 오류 — 정지 계정 단언은 SKIP");
    skip("정지 계정 단언(토큰 회수·재발급 거부·쓰기 거부)", "로그인 요청 실패");
    return;
  }
  if (L.r.status !== 200 || !L.jwt || !L.uid) {
    const banned = L.r.status >= 400 && L.r.status < 500;
    record(
      "auth 정지 프로브 계정 로그인",
      banned,
      "200(JWT 발급 → 아래에서 쓰기 거부 확인) 또는 4xx(로그인 자체 거부)",
      describeAuth(L),
      banned
        ? "GoTrue 가 정지 계정 로그인을 거부한다 — 더 강한 차단이라 PASS. 단, 비밀번호 오류와 구분되지 않으므로 픽스처가 정지 상태인지는 확인하지 못했다"
        : "예상 밖 응답",
    );
    skip("정지 계정 JWT 단언(토큰 회수·재발급 거부·쓰기 거부)", "정지 계정이 JWT 를 받지 못함");
    return;
  }
  record("auth 정지 프로브 계정 로그인(JWT 발급됨)", true, "200 또는 4xx", describeAuth(L), "086 은 로그인을 막지 않는다 — 아래에서 이 JWT 의 쓰기가 전부 거부되는지 본다");
  const { jwt, uid } = L;
  try {
    // 픽스처 + A02 회수: 정지 계정의 본인 프로필 읽기는 허용(GET)이라 여기서 disabled 와
    // mcp_token 을 함께 본다. 잡는 회귀: 086 의 정지 트리거/소급 회수가 토큰을 지우지 않음.
    const P = await http(rest(`profiles?id=eq.${uid}&select=id,disabled,mcp_token`), {
      headers: authHeaders(jwt),
    });
    const prof = Array.isArray(P.json) ? P.json[0] : undefined;
    const okFix = P.status === 200 && !!prof && prof.disabled === true;
    record(
      "fixture 정지 계정: 본인 프로필 disabled=true",
      okFix,
      "200 + 1행 (disabled=true)",
      describe(P) + (prof ? ` disabled=${prof.disabled}` : ""),
      okFix ? undefined : "픽스처가 정지 상태가 아니다 — 관리자 화면에서 정지시킬 것(아래 단언은 SKIP)",
    );
    if (!okFix) {
      skip("정지 계정 JWT 단언(토큰 회수·재발급 거부·쓰기 거부)", "픽스처 불일치");
      return;
    }
    const okTok = prof.mcp_token === null;
    record(
      "정지 계정: mcp_token 이 회수됨(null)",
      okTok,
      "mcp_token = null",
      `mcp_token = ${prof.mcp_token === null ? "null" : "(값 있음)"}`,
      okTok ? undefined : "정지됐는데 MCP 토큰이 남아 있다 — 086 의 회수 트리거·소급 회수 회귀(A02). 그 토큰은 mcp_uid 의 `not disabled` 만이 막고 있다",
    );

    // 재발급 거부 — 세 겹(086 게이트 → 084 `and not disabled` → 086 BEFORE 트리거) 중
    // 어디서든 막히면 된다. 2xx(토큰 문자열)면 정지 계정이 MCP 접근을 되살린 것(A02).
    const R = await rpc("mcp_token_regen", {}, jwt);
    const okR = isDisabledDenied(R);
    record(
      "rpc mcp_token_regen: 정지 계정 JWT → 거부",
      okR,
      "403 + 42501 (게이트/트리거) 또는 400 + 'account_disabled'",
      describe(R),
      okR
        ? undefined
        : isHexToken(R.json)
          ? "정지 계정이 토큰을 재발급했다 — 게이트·084 조건·086 트리거가 모두 뚫림(A02). 프로브가 즉시 폐기를 시도한다"
          : isMissingFn(R)
            ? MISSING_NOTE
            : "예상 밖 응답",
    );
    if (isHexToken(R.json)) await rpc("mcp_token_revoke", {}, jwt); // best-effort 정리

    // RPC 쓰기 거부 — p_on:false 라 회귀 상태에서 통해도 값은 바뀌지 않는다(기본값과 동일).
    const S = await rpc("mcp_set_write", { p_on: false }, jwt);
    const okS = isDisabledDenied(S);
    record(
      "rpc mcp_set_write: 정지 계정 JWT → 거부",
      okS,
      "403 + 42501 (게이트) 또는 400 + 'account_disabled'",
      describe(S),
      okS
        ? undefined
        : S.status >= 200 && S.status < 300
          ? "정지 계정의 RPC 쓰기가 통했다 — pre-request 게이트와 085 의 disabled 검사 회귀(A02)"
          : isMissingFn(S)
            ? MISSING_NOTE
            : "예상 밖 응답",
    );

    // 테이블 쓰기 거부 — RLS 2차 방어선 + 게이트.
    await assertSessionsInsert("정지", jwt, uid, true);
  } finally {
    await logout(jwt);
  }
}

async function accountAssertions() {
  const missing = [];
  const hasActive = ACCOUNTS.active.email && ACCOUNTS.active.password;
  const hasDisabled = ACCOUNTS.disabled.email && ACCOUNTS.disabled.password;
  if (!hasActive) missing.push("PROBE_USER_EMAIL/PROBE_USER_PASSWORD");
  if (!hasDisabled) missing.push("PROBE_DISABLED_EMAIL/PROBE_DISABLED_PASSWORD");
  if (missing.length) {
    // 시크릿 누락은 조용히 통과하면 안 된다 — 역할별 단언이 통째로 빠진 채 초록불이 되면
    // A01·A02·A03 회귀를 아무도 못 본다.
    record(
      "계정 단언: 프로브 계정 시크릿",
      false,
      "네 값 모두 설정",
      `비어 있음: ${missing.join(", ")}`,
      "레포 시크릿에 전용 프로브 계정 2개를 넣을 것(파일 머리 주석). 일부러 빼려면 PROBE_SKIP_ACCOUNTS=1",
    );
  }
  if (hasActive) await activeAccountFlow();
  if (hasDisabled) await disabledAccountFlow();
}

// ── 웹 단언 (A04 짝 + MCP 인증 관문) ─────────────────────────────────────────
const ICS_PATH = `/programs/${NIL_UUID}/calendar.ics`;

/**
 * 비로그인 ICS 구독 fetch 는 route 까지 도달해 4xx(없는 프로그램 → 404, 토큰 없음 → 401)
 * 를 받아야 한다. 잡는 회귀: proxy.ts 의 보호 목록·matcher 가 이 경로를 다시 삼켜
 * /login 으로 307 → 캘린더 서비스가 ICS 대신 로그인 HTML 을 받음(A04).
 */
async function assertIcsReachesRoute(name, path, expected) {
  const r = await http(SITE_URL + path);
  const ok = r.status === expected;
  record(
    name,
    ok,
    `${expected} (route 가 직접 거부)`,
    describe(r),
    ok
      ? undefined
      : r.status >= 300 && r.status < 400
        ? "로그인 리다이렉트 — proxy 가 ICS 구독 경로를 다시 보호 목록에 넣었다(A04 회귀)"
        : r.status >= 200 && r.status < 300
          ? "없는 프로그램에 2xx — 접근 통제가 사라졌다"
          : r.status >= 400 && r.status < 500
            ? `다른 4xx(${r.status}) — route 의 거부 분기(401 토큰 없음 / 404 불일치)가 바뀌었다`
            : "예상 밖 응답",
  );
}

/**
 * ICS 예외가 /programs 전체를 열어 버리지 않았는지. 잡는 회귀: 예외 정규식이 넓어져
 * (앵커 소실·접두 매칭) 프로그램 화면이 비로그인에 노출됨.
 */
async function assertProgramsStillProtected() {
  const r = await http(`${SITE_URL}/programs`);
  const ok =
    r.status >= 300 &&
    r.status < 400 &&
    typeof r.location === "string" &&
    r.location.includes("/login");
  record(
    "web /programs: 비로그인 → /login 리다이렉트 유지",
    ok,
    "3xx + Location 에 /login",
    describe(r),
    ok
      ? undefined
      : r.status >= 200 && r.status < 300
        ? "보호 경로가 비로그인에 열렸다 — ICS 예외 정규식이 너무 넓다"
        : "예상 밖 응답",
  );
}

/**
 * /api/mcp 는 토큰 없는 호출을 401 로 거부해야 한다(withMcpAuth required:true).
 * 잡는 회귀: 인증 래퍼가 빠지거나 required 가 풀려 빈 토큰이 RPC 까지 흘러감(각 RPC 가
 * null 을 주긴 하지만 도구 목록·서버 정보가 익명에게 열린다).
 */
async function assertMcpNoTokenUnauthorized() {
  const x = await mcpToolCall("", "get_profile", {});
  const ok = x.status === 401;
  record(
    "web /api/mcp: 토큰 없는 tools/call → 401",
    ok,
    "401",
    describeMcp(x),
    ok
      ? undefined
      : x.status === 200
        ? "토큰 없이 MCP 가 응답했다 — withMcpAuth required 소실"
        : "예상 밖 응답",
  );
}

async function webAssertions() {
  await assertIcsReachesRoute(
    "web ICS 구독(?token=x): 없는 프로그램 → 404 (로그인 307 아님)",
    `${ICS_PATH}?token=x`,
    404,
  );
  await assertIcsReachesRoute(
    "web ICS 다운로드(토큰 없음, 비로그인) → 401 (로그인 307 아님)",
    ICS_PATH,
    401,
  );
  await assertProgramsStillProtected();
  await assertMcpNoTokenUnauthorized();
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(
    `db-permission-probe — db=${SKIP_DB ? "skip" : new URL(SUPABASE_URL).host} web=${SKIP_WEB ? "skip" : SITE_URL} accounts=${SKIP_DB || SKIP_ACCOUNTS ? "skip" : "on"}`,
  );

  if (SKIP_DB) {
    skip("DB 단언 전체(익명·계정)", "PROBE_SKIP_DB=1");
  } else if (!ANON_KEY) {
    // 시크릿 누락은 조용히 통과하면 안 된다 — "검사가 돌았다"는 착각이 가장 위험하다.
    record(
      "DB 단언 전체",
      false,
      "SUPABASE_ANON_KEY 설정",
      "SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY 둘 다 비어 있음",
      "레포 시크릿에 anon(publishable) 키를 넣을 것. 한쪽만 돌리려면 PROBE_SKIP_DB=1",
    );
  } else {
    refuseNonAnonKey(ANON_KEY);
    await anonAssertions();
    if (SKIP_ACCOUNTS) {
      skip("계정 단언 전체(활성·정지 프로브 계정)", "PROBE_SKIP_ACCOUNTS=1");
    } else {
      await accountAssertions();
    }
  }

  if (SKIP_WEB) {
    skip("웹 단언 전체", "PROBE_SKIP_WEB=1");
  } else {
    await webAssertions();
  }

  const failed = results.filter((r) => r.ok === false);
  const passed = results.filter((r) => r.ok === true);
  const skipped = results.filter((r) => r.ok === null);
  console.log(
    `\n결과: PASS ${passed.length} / FAIL ${failed.length} / SKIP ${skipped.length}`,
  );
  if (skipped.length) {
    for (const s of skipped) console.log(`  - SKIP ${s.name} (${s.note})`);
  }
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.name}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e?.__hard ? `중단: ${e.message}` : e);
  process.exitCode = e?.__hard ? 2 : 1;
});
