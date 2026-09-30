/** Fixture-only design checks. No production credentials or writes. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "playwright");
const base = process.env.ROX_CAPTURE_BASE ?? "http://127.0.0.1:3111";
const out = process.env.ROX_AUDIT_OUT ?? ".captures/audit";
const id = "00000000-0000-4000-8000-000000000001";
const event = `/crews/loop8/schedule/${id}`;
const routes = [
  ["/", "out"], ["/login", "out"], ["/dashboard", "in"],
  ["/sessions", "in"], ["/sessions/new", "in"], ["/programs/new", "in"],
  [`/programs/${id}?preview=1`, "in"], ["/predict", "in"],
  ["/runs/new", "in"], ["/schedule", "in"],
  ["/crews/loop8/finance", "in"], [event, "in"],
  ["/", "out", "en"], ["/", "out", "es"],
];
const widths = [320, 360, 375, 390, 430, 600, 767, 768, 1200];
const browser = await chromium.launch();
const report = [];
await mkdir(out, { recursive: true });

try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ko-KR" });
    const page = await context.newPage();
    for (const [route, auth, locale = "ko"] of routes) {
      const errors = [];
      const onError = (error) => errors.push(String(error));
      page.on("pageerror", onError);
      try {
        await context.clearCookies();
        await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
        if (auth === "out") await context.addCookies([{ name: "rox_fixture_auth", value: "out", url: base }]);
        const response = await page.goto(base + route, { waitUntil: "networkidle", timeout: 30000 });
        assert.equal(response?.status(), 200, route);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route}: document overflow`);
        assert.deepEqual(errors, [], `${route}: page errors`);
        assert.match(await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily), /Pretendard Variable/);
        const brand = page.locator(".rx-brand strong, .rx-public-brand").first();
        if (await brand.isVisible()) {
          assert.match(await brand.evaluate((el) => getComputedStyle(el).fontFamily), /Archivo Black/);
          assert.equal(await page.evaluate(() => [...document.fonts].some((font) => font.family.includes("Archivo Black") && font.status === "loaded")), true);
        }
        if (route === "/") {
          assert.equal(await page.locator(".rx-landing-hero h1").evaluate((el) => getComputedStyle(el).fontWeight), "800", "marketing heading retains Korean fallback weight");
        }
        if (width <= 600) {
          const inputs = await page.locator('.rx-main input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])').evaluateAll((els) => els.filter((el) => el.getClientRects().length).map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height })));
          for (const input of inputs) {
            assert.ok(input.size >= 16, `${route}: input font ${input.size}`);
            assert.ok(input.height >= 48, `${route}: input height ${input.height}`);
          }
        }
        if (route === "/sessions") {
          const tables = page.locator('[data-slot="table-container"][tabindex="0"]');
          for (const table of await tables.all()) {
            assert.equal(await table.getAttribute("role"), "region");
            assert.ok(await table.getAttribute("aria-label"));
            await table.focus();
            const start = await table.evaluate((el) => el.scrollLeft);
            await page.keyboard.press("ArrowRight");
            await page.waitForTimeout(150);
            assert.ok(await table.evaluate((el) => el.scrollLeft) > start, "table keyboard scrolling");
          }
        }
        if (route === "/schedule" && width <= 600) {
          for (const button of await page.locator(".rx-week button").all()) {
            const box = await button.boundingBox();
            assert.ok(box && box.width >= 44 && box.height >= 44, "calendar target");
          }
        }
        if (route.includes("?preview=1")) {
          assert.equal(await page.getByRole("button", { name: "복제", exact: true }).count(), 1, "preview allows cloning");
          assert.equal(await page.getByRole("button", { name: "삭제", exact: true }).count(), 0, "preview hides owner deletion");
          assert.equal(await page.getByRole("button", { name: "기본 정보 수정", exact: true }).count(), 0, "preview hides basic editing");
          assert.equal(await page.getByRole("button", { name: /링크 재발급/ }).count(), 0, "preview hides token regeneration");
        }
        if (route === event && (width === 390 || width === 1200)) {
          await page.getByRole("button", { name: "인스타 태그 복사", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: "인스타 태그 복사", exact: true });
          await dialog.waitFor();
          if (width < 768) assert.equal(await dialog.locator(':scope > [aria-hidden="true"]').count(), 1, "one sheet handle");
          const box = await dialog.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width, "dialog fits viewport");
          await page.screenshot({ path: `${out}/${width}_meetup_dialog_${locale}.png`, fullPage: true });
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden" });
          assert.equal(await page.getByRole("button", { name: "인스타 태그 복사", exact: true }).evaluate((el) => el === document.activeElement), true, "dialog focus return");
        }
        if (route === "/dashboard" && width === 390) {
          await page.locator('[data-slot="sidebar-trigger"]').click();
          const drawer = page.locator('[data-slot="sidebar"][data-mobile="true"]');
          await drawer.waitFor();
          assert.ok((await drawer.getAttribute("class"))?.includes("rx-sidebar"));
          await page.screenshot({ path: `${out}/${width}_drawer_${locale}.png`, fullPage: true });
          await drawer.locator(".rx-profile").click();
          await drawer.waitFor({ state: "hidden" });
          await page.waitForURL("**/settings/profile");
          await page.goto(base + route, { waitUntil: "networkidle" });
        }
        if (width === 390 || width === 1200) {
          const name = route.replace(/[^a-z0-9]+/gi, "_");
          await page.screenshot({ path: `${out}/${width}${name}_${locale}.png`, fullPage: true });
        }
        report.push({ width, route, locale, ok: true });
      } catch (error) {
        const overflowing = await page.evaluate(() => [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 20).map((el) => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width }))).catch(() => []);
        await page.screenshot({ path: `${out}/failed_${width}${route.replace(/[^a-z0-9]+/gi, "_")}_${locale}.png`, fullPage: true }).catch(() => {});
        report.push({ width, route, locale, ok: false, error: String(error), pageErrors: errors, overflowing });
      } finally {
        page.off("pageerror", onError);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
const failures = report.filter((row) => !row.ok);
console.log(JSON.stringify({ cases: report.length, failures }, null, 2));
assert.equal(failures.length, 0, "See report.json for failed design checks.");
