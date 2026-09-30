import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { loadTypeScript } from "../scripts/load-typescript.mjs";

const { brandFallback, renderCard } = loadTypeScript("lib/og/card.tsx");

async function checkPng(response, name) {
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  await mkdir(".captures/audit", { recursive: true });
  await writeFile(`.captures/audit/${name}.png`, bytes);
}

test("crew OG renders Korean names with the repository's original fonts and mark", async () => {
  await checkPng(await renderCard({
    kind: "crew", title: "함께 달리는 크루", subtitle: "LOOP8 · 하이브리드 레이싱",
    details: "서울 · 함께 훈련해요", count: "26", countLabel: "MEMBERS",
  }), "og-crew");
});

test("meetup OG renders a Korean title and attendance count", async () => {
  await checkPng(await renderCard({
    kind: "event", title: "주말 러닝과 스테이션 훈련", subtitle: "함께 달리는 크루",
    details: "30 Sept 2026, 18:00 KST", count: "8 / 12", countLabel: "GOING",
  }), "og-event");
});

test("private or unavailable data gets a non-cached neutral brand image", async () => {
  await checkPng(await brandFallback(), "og-fallback");
});
