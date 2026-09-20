import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { loadTypeScript } from "../scripts/load-typescript.mjs";
import * as React from "react";

function nodes(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}

function programPage(owner, enrolled) {
  const mocks = {
    "next/link": "a",
    "next/navigation": { notFound: () => { throw new Error("not found"); } },
    "@/lib/supabase/auth": { getCachedUser: async () => ({ id: owner ? "owner" : "member" }) },
    "@/lib/i18n": { getT: async () => ({ t: (k) => k, tag: "ko-KR", locale: "ko", tz: "Asia/Seoul" }) },
    "@/lib/format": { formatDateShort: (s) => s, programDayDate: () => null },
    "@/lib/target": { targetParts: () => [] },
    "@/lib/wod-type": { wodTypeDot: () => "" },
  };
  const components = {};
  for (const [file, name] of Object.entries({
    "program-builder": "ProgramBuilder", "program-basics-editor": "ProgramBasicsEditor",
    "program-calendar-subscribe": "ProgramCalendarSubscribe", "program-enroll-button": "ProgramEnrollButton",
    "clone-program-button": "CloneProgramButton", "delete-button": "DeleteButton",
  })) {
    components[name] = () => null;
    mocks[`@/components/${file}`] = { [name]: components[name] };
  }
  const queries = [];
  mocks["@/lib/supabase/server"] = { createClient: async () => ({ from: (table) => {
    queries.push(table);
    const query = {
      select: () => query, eq: () => query,
      order: async () => ({ data: [] }),
      maybeSingle: async () => ({ data: table === "programs" ? {
        id: "program", owner_id: "owner", title: "Training", is_public: true,
        program_days: [], calendar_token: "test-only-token",
      } : enrolled ? { start_date: "2026-09-20", repeat: false } : null }),
    };
    return query;
  } }) };
  return { Page: loadTypeScript("app/(app)/programs/[id]/page.tsx", mocks).default, components, queries };
}

for (const owner of [true, false]) for (const preview of [undefined, "1"]) for (const enrolled of [true, false]) {
  test(`program owner=${owner}, preview=${preview}, enrolled=${enrolled}`, async () => {
    const { Page, components: c, queries } = programPage(owner, enrolled);
    const tree = nodes(await Page({ params: Promise.resolve({ id: "program" }), searchParams: Promise.resolve({ preview }) }));
    const find = (component) => tree.find((n) => n.type === component);
    const editable = owner && preview !== "1";
    assert.equal(!!find(c.ProgramBasicsEditor), editable);
    assert.equal(!!find(c.DeleteButton), editable);
    assert.equal(!!find(c.ProgramBuilder), editable);
    assert.equal(!!find(c.CloneProgramButton), !editable);
    assert.equal(queries.includes("exercises"), editable);
    assert.equal(find(c.ProgramEnrollButton).props.initialActive, enrolled);
    assert.equal(!!find(c.ProgramCalendarSubscribe), enrolled);
    if (enrolled) assert.equal(find(c.ProgramCalendarSubscribe).props.isOwner, editable);
    assert.equal(tree.some((n) => n.type === "a" && n.props.href?.endsWith("/calendar.ics")), enrolled);
    assert.equal(tree.some((n) => n.props?.children === "programs.backToBuilder"), owner && preview === "1");
  });
}

const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const publicCrew = { slug: "loop8", name: "공개 크루", crew_status: "active", member_count: 23, tagline: null, description: null, location: "서울" };
const publicEvent = { id, slug: "loop8", title: "공개 모임", description: "함께 훈련합니다", starts_at: "2026-09-20T00:00:00Z", members_only: false, going: [{ name: "Never render this name" }], capacity: 30 };

function publicData(crew = publicCrew, event = publicEvent, error = null) {
  const calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  const api = loadTypeScript("lib/og/public-data.ts", {
    react: { cache: (fn) => fn },
    "@supabase/supabase-js": { createClient: (url, key, options) => {
      calls.push({ url, key, options });
      return { rpc: (rpc, args) => ({ select: async (fields) => {
        calls.push({ rpc, args, fields });
        const row = rpc === "crew_overview" ? crew : event;
        return { data: row ? [row] : [], error };
      } }) };
    } },
  });
  return { ...api, calls };
}

test("public event exposes only share fields, counts attendees, and uses an anonymous client", async () => {
  const api = publicData();
  const result = await api.getPublicEvent("loop8", id);
  assert.equal(result.title, publicEvent.title);
  assert.equal(result.goingCount, 1);
  assert.equal(JSON.stringify(result).includes("Never render"), false);
  const { options, key } = api.calls[0];
  assert.equal(key, "test-anon-key");
  assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_input, init) => init;
    const init = await options.global.fetch("https://example.invalid", {});
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  } finally { global.fetch = originalFetch; }
});

for (const [label, crew, event, error] of [
  ["private/missing crew", null, publicEvent],
  ["inactive crew", { ...publicCrew, crew_status: "pending" }, publicEvent],
  ["members-only event", publicCrew, { ...publicEvent, members_only: true }],
  ["missing visibility field", publicCrew, { ...publicEvent, members_only: undefined }],
  ["mismatched slug", publicCrew, { ...publicEvent, slug: "another-crew" }],
  ["mismatched UUID", publicCrew, { ...publicEvent, id: "other" }],
  ["cancelled/missing event", publicCrew, null],
  ["invalid date", publicCrew, { ...publicEvent, starts_at: "invalid" }],
  ["RPC failure", publicCrew, publicEvent, { message: "denied" }],
]) test(`share data falls back for ${label}`, async () => {
  assert.equal(await publicData(crew, event, error).getPublicEvent("loop8", id), null);
});

test("invalid UUID does not query Supabase", async () => {
  const api = publicData();
  assert.equal(await api.getPublicEvent("loop8", "invalid"), null);
  assert.equal(api.calls.length, 0);
});

function oneTap(exchange = async () => ({ error: null })) {
  const errors = [], pushes = [], exchanges = [];
  let refreshes = 0;
  const loaded = loadTypeScript("components/google-one-tap.tsx", {
    react: { ...React, useCallback: (fn) => fn, useRef: (current) => ({ current }), useState: () => [null, (e) => errors.push(e)] },
    "next/script": "script",
    "next/navigation": { useRouter: () => ({ push: (s) => pushes.push(s), refresh: () => refreshes++ }) },
    "@/lib/supabase/client": { createClient: () => ({ auth: { signInWithIdToken: async (args) => { exchanges.push(args); return exchange(args); } } }) },
    "@/lib/site-url": loadTypeScript("lib/site-url.ts"),
    "@/components/i18n-provider": { useI18n: () => ({ t: (key) => key }) },
  });
  return { ...loaded, errors, pushes, exchanges, refreshes: () => refreshes };
}

test("One Tap prompts once, retains FedCM/outside policy, and exchanges matching nonce", { timeout: 2000 }, async () => {
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "test-client";
  let prompts = 0, config, ready;
  const initialized = new Promise((resolve) => { ready = resolve; });
  global.window = { google: { accounts: { id: { initialize: (o) => { config = o; ready(); }, prompt: () => prompts++ } } } };
  const api = oneTap();
  const script = nodes(api.GoogleOneTap({ next: "/crews/loop8" })).find((n) => n.type === "script");
  script.props.onReady(); script.props.onReady();
  await initialized;
  assert.equal(prompts, 1);
  assert.equal(config.use_fedcm_for_prompt, true);
  assert.equal(config.cancel_on_tap_outside, false);
  await config.callback({ credential: "test-credential" });
  assert.equal(createHash("sha256").update(api.exchanges[0].nonce).digest("hex"), config.nonce);
  assert.deepEqual(api.pushes, ["/crews/loop8"]);
  assert.equal(api.refreshes(), 1);
  script.props.onReady(); await initialized;
  assert.equal(prompts, 1);
  delete global.window;
});

test("One Tap SDK and exchange failures produce fallback guidance without navigation/retry", { timeout: 2000 }, async () => {
  let config, prompts = 0, ready;
  const initialized = new Promise((resolve) => { ready = resolve; });
  global.window = { google: { accounts: { id: { initialize: (o) => { config = o; ready(); }, prompt: () => prompts++ } } } };
  const api = oneTap(async () => { throw new Error("offline"); });
  const script = nodes(api.GoogleOneTap({ next: "//evil.example" })).find((n) => n.type === "script");
  script.props.onError();
  assert.deepEqual(api.errors, ["auth.oneTapUnavailable"]);
  script.props.onReady(); await initialized;
  await config.callback({ credential: "test-credential" });
  assert.deepEqual(api.errors, ["auth.oneTapUnavailable", "auth.oneTapUnavailable"]);
  assert.deepEqual(api.pushes, []);
  assert.equal(api.refreshes(), 0);
  assert.equal(prompts, 1);
  delete global.window;
});

test("One Tap stays absent without a client ID", () => {
  delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  assert.equal(oneTap().GoogleOneTap({}), null);
});
