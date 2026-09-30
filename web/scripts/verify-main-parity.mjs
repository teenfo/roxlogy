/** Fixture-only main parity verification. Production Supabase is never contacted. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "playwright");
const base = process.env.ROX_CAPTURE_BASE ?? "http://127.0.0.1:3111";
const out = process.env.ROX_AUDIT_OUT ?? ".captures/audit";
const report = [];
const browser = await chromium.launch();
await mkdir(out, { recursive: true });
const routes = ["/timing", "/timing/join", "/timing/new", "/pft", "/pft/race", "/pft/race/join", "/pft/race/new", "/pft/race/PFT006", "/pft/race/PFT006/staff", "/board/PFT006", "/admin/races", "/crews/loop8/members", "/crews/loop8/members?tier=__staff__", "/crews/loop8/schedule?m=2026-09", ...[16, 24, 32].flatMap((n) => [`/timing/SIM0${n}`, `/timing/SIM0${n}/staff`, `/board/SIM0${n}`])];

try {
  for (const width of [320, 390, 1200]) {
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "ko-KR", permissions: ["clipboard-read", "clipboard-write"] });
      await context.addCookies([{ name: "NEXT_LOCALE", value: "ko", url: base }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      try {
        const response = await page.goto(base + route, { waitUntil: "networkidle" });
        assert.equal(response?.status(), 200);
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "document overflow");
        const sim = /SIM0(16|24|32)/.exec(route);
        if (sim && route.startsWith("/board")) {
          assert.equal(await page.locator(".rx-live-stages > div").count(), 8);
          assert.equal(await page.locator(".rx-live-timing .rx-sim-progress > span").count(), Number(sim[1]));
          assert.ok((await page.locator(".rx-live-footer a").first().getAttribute("href")).startsWith("/timing/"));
          assert.doesNotMatch(await page.locator(".rx-live-finish footer").innerText(), /골드|실버/);
          assert.doesNotMatch(await page.locator(".rx-live-finish").innerText(), /6개 종목/);
        }
        if (route === "/timing") {
          assert.equal(await page.locator(".rx-record-row").count(), 3);
          for (const a of await page.locator(".rx-record-row").all()) assert.ok((await a.getAttribute("href")).startsWith("/timing/"));
        }
        if (route === "/pft/race") {
          assert.equal(await page.locator(".rx-record-row").count(), 1);
          assert.equal(await page.locator(".rx-record-row").getAttribute("href"), "/pft/race/PFT006");
        }
        if (route === "/pft/race/join") assert.equal(await page.locator(".rx-pft-member").count(), 1);
        if (route.includes("/schedule?")) assert.ok(await page.locator(".rx-going-avatars").count() > 0, "crew schedule retains attendee avatars");
        if (route === "/timing/join") assert.equal(await page.locator(".rx-pft-member").count(), 3);
        if (route === "/pft/race/new") assert.equal(await page.getByRole("tab", { name: "32 구간", exact: true }).count(), 0);

        if (width === 390 && route === "/timing/new") {
          await page.getByRole("tab", { name: "32 구간", exact: true }).click();
          await page.getByRole("textbox").first().fill("Simulation created from timing");
          await page.getByRole("button", { name: "타임체크 만들기", exact: true }).click();
          await page.waitForURL("**/timing/SIM032");
          await page.locator(".rx-sim-clock .rx-sim-progress > span").last().waitFor();
          assert.equal(await page.locator(".rx-sim-progress > span").count(), 32);
        }
        if (width === 390 && sim && route === `/timing/SIM0${sim[1]}`) {
          const n = Number(sim[1]);
          assert.equal(await page.locator(".rx-sim-clock .rx-sim-progress > span").count(), n);
          const tap = page.locator(".rx-sim-tap");
          assert.ok(await tap.isVisible(), "simulation remains running after PFT checkpoint 6");
          await tap.click();
          await page.waitForFunction((n) => document.querySelector(".rx-sim-clock > span")?.textContent === `${n}/${n}`, n);
          await page.waitForTimeout(1300);
          await tap.click();
          await page.getByRole("link", { name: "세션 보기", exact: true }).waitFor();
          assert.match(await page.getByRole("link", { name: "세션 보기", exact: true }).getAttribute("href"), /^\/sessions\//);
          await page.getByRole("button", { name: "완주 취소", exact: true }).click();
          await tap.waitFor();
          assert.equal(await page.getByRole("link", { name: "세션 보기", exact: true }).count(), 0);
        }
        if (width === 390 && sim && route.endsWith("/staff")) {
          const card = page.locator(".rx-pft-athlete").filter({ hasText: "Fixture runner" });
          const before = await card.locator(".rx-sim-progress > span[style*=background]").count();
          await card.locator(".rx-primary").click();
          await page.waitForFunction(({ count }) => document.querySelector(".rx-pft-athlete .rx-sim-progress")?.getAttribute("aria-label")?.includes(String(count)), { count: Number(sim[1]) - 1 });
          assert.ok(before > 6);
        }
        if (width === 390 && route.includes("/members?tier=")) {
          const rowCount = await page.locator("tbody tr").count();
          const downloadPromise = page.waitForEvent("download");
          await page.getByRole("button", { name: "명단 다운로드", exact: true }).click();
          const download = await downloadPromise;
          const csv = await readFile(await download.path(), "utf8");
          assert.equal(csv.charCodeAt(0), 0xfeff);
          assert.equal(csv.trim().split("\r\n").length, rowCount + 1, "CSV respects current tier filter");
          assert.match(csv, /@rox_/);
          const handle = page.locator("button.rx-insta").first();
          const text = await handle.innerText();
          await handle.click();
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
          assert.equal(await handle.innerText(), "복사됨");
        }
        if (width === 390 && route === "/timing") {
          await page.locator('[data-slot="sidebar-trigger"]').click();
          const drawer = page.getByRole("dialog");
          assert.equal(await drawer.getByRole("link", { name: "시뮬 타임체크", exact: true }).count(), 1);
          await page.keyboard.press("Escape");
        }
        assert.deepEqual(errors, []);
        if (width !== 320 && (route.includes("SIM032") || route === "/timing/new" || route === "/crews/loop8/members?tier=__staff__")) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(150);
          await page.screenshot({ path: `${out}/parity-${route.replace(/[^a-zA-Z0-9]+/g, "-")}-${width}.png`, fullPage: true, animations: "disabled" });
        }
        report.push({ width, route, pass: true });
      } catch (e) {
        report.push({ width, route, pass: false, error: String(e) });
        console.error(JSON.stringify(report.at(-1)));
        await page.screenshot({ path: `${out}/parity-failure-${report.length}.png`, fullPage: true, animations: "disabled" }).catch(() => {});
      } finally { await context.close(); }
    }
  }
  // Protected route retains its destination through login; public board stays open.
  const context = await browser.newContext();
  await context.addCookies([{ name: "rox_fixture_auth", value: "out", url: base }]);
  const page = await context.newPage();
  await page.goto(base + "/timing/SIM032");
  assert.equal(new URL(page.url()).pathname, "/login");
  assert.equal(new URL(page.url()).searchParams.get("next"), "/timing/SIM032");
  assert.equal((await page.goto(base + "/board/SIM032"))?.status(), 200);
  await context.close();
  report.push({ route: "timing login destination + public board", pass: true });
} finally {
  await browser.close();
  await writeFile(`${out}/main-parity-report.json`, JSON.stringify(report, null, 2));
}
const failed = report.filter((r) => !r.pass);
console.log(JSON.stringify({ cases: report.length, failed: failed.length }));
if (failed.length) process.exitCode = 1;
