/**
 * 전 화면 캡쳐 — 리뉴얼 전/후 비교 기준선.
 *
 *   1) ROX_FIXTURES=1 로 빌드하고 next start 로 띄운다
 *   2) node scripts/capture-screens.mjs [--out .captures/before] [--only <패턴>]
 *
 * 데이터는 픽스처다(lib/supabase/__fixtures__). 레이아웃은 실제 코드 그대로이므로
 * 구조·간격·넘침을 보는 데는 쓸 수 있지만, **실제 길이의 한글 이름·제목에서의
 * 넘침은 이 캡쳐로 확인되지 않는다.**
 *
 * 각 폭에서 가로 스크롤(문서가 뷰포트보다 넓은지)을 같이 재서 보고한다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * playwright 는 이 프로젝트의 의존성이 아니다(캡쳐 전용). 로컬 설치본이 있으면
 * 그걸 쓰고, 없으면 전역 설치본을 찾는다 — `PLAYWRIGHT_PATH` 로 지정할 수도 있다.
 */
const chromium = await (async () => {
  const req = createRequire(import.meta.url);
  const tries = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    "/opt/node22/lib/node_modules/playwright",
    "/usr/lib/node_modules/playwright",
  ].filter(Boolean);
  for (const spec of tries) {
    try {
      return req(spec).chromium;
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error(
    "playwright 를 찾지 못했습니다. `npm i -D playwright` 하거나 PLAYWRIGHT_PATH 를 지정하세요.",
  );
})();

const BASE = process.env.ROX_CAPTURE_BASE ?? "http://localhost:3111";
const WIDTHS = [1200, 390];

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const i = args.indexOf(k);
  return i === -1 ? d : args[i + 1];
};
const OUT = argOf("--out", ".captures/before");
const ONLY = argOf("--only", null);
/**
 * 다른 라우트 목록으로 찍을 때 — 시안 프로토타입(디자인 리뉴얼 P0 기준 렌더)은
 * 엔티티 id 가 우리 픽스처와 달라서 JSON 파일로 목록을 통째로 바꿔 넣는다.
 * 파일 모양은 아래 ROUTES 와 같다: `[["/path", "in"|"out"], …]`.
 */
const ROUTES_FILE = argOf("--routes", null);

const ID = "00000000-0000-4000-8000-000000000001";
const SLUG = "loop8";
const CODE = "QT2S7L";

/** auth: "in" = 로그인 픽스처, "out" = 비로그인(미들웨어가 / ·/login 을 안 돌린다) */
const ROUTES = [
  // 공개·인증 (비로그인으로 찍어야 리다이렉트되지 않는다)
  ["/", "out"],
  ["/login", "out"],
  ["/signup", "out"],
  ["/auth/native", "out"],
  ["/crews", "out"],
  [`/crews/${SLUG}`, "out"],
  ["/__notfound__", "out"],

  // 권한 차단 화면
  [`/crews/${SLUG}/members`, "out"],
  [`/crews/${SLUG}/leaderboard`, "out"],

  // 앱 홈·기록
  ["/dashboard", "in"],
  ["/sessions", "in"],
  ["/sessions/new", "in"],
  ["/sessions/compare", "in"],
  [`/sessions/${ID}`, "in"],
  [`/sessions/${ID}/edit`, "in"],
  ["/races", "in"],
  ["/races/new", "in"],
  [`/races/${ID}`, "in"],

  // 훈련
  ["/schedule", "in"],
  [`/schedule/race/${ID}`, "in"],
  ["/programs", "in"],
  ["/programs/new", "in"],
  [`/programs/${ID}`, "in"],
  [`/programs/${ID}?preview=1`, "in"],
  [`/workouts/${ID}`, "in"],
  ["/runs", "in"],
  ["/runs/new", "in"],
  [`/runs/${ID}/edit`, "in"],
  ["/exercises", "in"],
  [`/exercises/${ID}`, "in"],

  // 레이스·PFT
  ["/goals", "in"],
  ["/predict", "in"],
  ["/insights", "in"],
  ["/events", "in"],
  [`/events/${ID}`, "in"],
  ["/leaderboard", "in"],
  ["/pft", "in"],
  ["/pft/new", "in"],
  ["/pft/measure", "in"],
  [`/pft/${ID}/edit`, "in"],
  ["/pft/leaderboard", "in"],
  ["/pft/race", "in"],
  ["/pft/race/join", "in"],
  ["/pft/race/new", "in"],
  [`/pft/race/${CODE}`, "in"],
  [`/pft/race/${CODE}/staff`, "in"],
  [`/board/${CODE}`, "in"],

  // 크루
  ["/crews/new", "in"],
  [`/crews/${SLUG}/schedule`, "in"],
  [`/crews/${SLUG}/schedule/${ID}`, "in"],
  [`/crews/${SLUG}/board`, "in"],
  [`/crews/${SLUG}/board/new`, "in"],
  [`/crews/${SLUG}/board/${ID}`, "in"],
  [`/crews/${SLUG}/board/${ID}/edit`, "in"],
  [`/crews/${SLUG}/members`, "in"],
  [`/crews/${SLUG}/leaderboard`, "in"],
  [`/crews/${SLUG}/finance`, "in"],
  [`/crews/${SLUG}/finance?tab=dues`, "in"],
  [`/crews/${SLUG}/manage`, "in"],
  [`/crews/${SLUG}/manage?tab=members`, "in"],
  [`/crews/${SLUG}/manage?tab=dues`, "in"],
  [`/crews/${SLUG}/manage?tab=programs`, "in"],

  // 커뮤니티·설정
  ["/feed", "in"],
  ["/members", "in"],
  [`/u/${ID}`, "in"],
  ["/search", "in"],
  ["/notifications", "in"],
  ["/settings/profile", "in"],
  ["/download", "in"],

  // 관리자
  ["/admin", "in"],
  ["/admin/users", "in"],
  [`/admin/users/${ID}`, "in"],
  ["/admin/content", "in"],
  ["/admin/crews", "in"],
  ["/admin/races", "in"],
  ["/admin/moderation", "in"],
];

const routes = ROUTES_FILE
  ? JSON.parse(await readFile(ROUTES_FILE, "utf8"))
  : ROUTES;

const slugify = (p) =>
  p.replace(/^\//, "").replace(/[/?=&]/g, "_").replace(/^$/, "home") || "home";

const browser = await chromium.launch();
const report = [];

for (const width of WIDTHS) {
  for (const [route, auth] of routes) {
    if (ONLY && !route.includes(ONLY)) continue;
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      locale: "ko-KR",
    });
    if (auth === "out") {
      await ctx.addCookies([
        { name: "rox_fixture_auth", value: "out", url: BASE },
      ]);
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

    let status = 0;
    try {
      const res = await page.goto(BASE + route, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      status = res?.status() ?? 0;
      await page.waitForTimeout(400);
      const dir = path.join(OUT, String(width));
      await mkdir(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, `${slugify(route)}.png`),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      report.push({ width, route, status, overflow, errors: errors.slice(0, 2) });
      const flag = overflow ? " ⟵ 가로 넘침" : "";
      console.log(`${String(width).padStart(4)}  ${status}  ${route}${flag}`);
    } catch (e) {
      report.push({ width, route, status, error: String(e).slice(0, 160) });
      console.log(`${String(width).padStart(4)}  ERR  ${route}  ${String(e).slice(0, 80)}`);
    }
    await ctx.close();
  }
}

await browser.close();
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

const bad = report.filter((r) => r.error || (r.status && r.status >= 400));
const over = report.filter((r) => r.overflow);
console.log(`\n캡쳐 ${report.length}건 · 실패 ${bad.length} · 가로 넘침 ${over.length}`);
if (over.length) {
  console.log("넘침: " + over.map((r) => `${r.route}@${r.width}`).join(", "));
}
