import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "../scripts/load-typescript.mjs";

const id = "00000000-0000-4000-8000-000000000001";
const crew = { slug: "loop8", name: "LOOP8", tagline: "Hybrid racing", description: "Public introduction", location: "Seoul", member_count: 8, crew_status: "active", bank_account: "PRIVATE", my_role: "owner" };
const event = { id, slug: "loop8", title: "Public meetup", description: "Join us", starts_at: "2026-09-30T09:00:00Z", location: "Seoul", capacity: 10, going: [{ name: "PRIVATE ATTENDEE" }], comments: [{ body: "PRIVATE COMMENT" }], members_only: false };

function harness(overrides = {}) {
  const calls = [];
  const options = [];
  const mod = loadTypeScript("lib/og/public-data.ts", {
    react: { cache: (fn) => fn },
    "@supabase/supabase-js": {
      createClient: (url, key, config) => {
        options.push({ url, key, config });
        return {
          rpc: (name, args) => ({
            select: async (columns) => {
              calls.push({ name, args, columns });
              const result = overrides[name];
              if (result instanceof Error) throw result;
              if (result) return result;
              return { data: [name === "crew_overview" ? crew : event], error: null };
            },
          }),
        };
      },
    },
  });
  return { ...mod, options, calls };
}

// Dummy configuration only; no real network or database is used by this test.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture";

test("public crew share data drops membership and account fields", async () => {
  const h = harness();
  const result = await h.getPublicCrew("loop8");
  assert.equal(result.name, "LOOP8");
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.equal(h.options[0].config.auth.persistSession, false);
  assert.equal(h.options[0].config.auth.autoRefreshToken, false);
  assert.equal(h.options[0].config.auth.detectSessionInUrl, false);
  assert.equal(h.options[0].key, "fixture");
});

test("public meetup share data includes counts but no attendee names or comments", async () => {
  const h = harness();
  const result = await h.getPublicEvent("loop8", id);
  assert.equal(result.goingCount, 1);
  assert.equal(result.capacity, 10);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.ok(h.calls.some((call) => call.args.p_event === id));
});

test("member-only and cross-crew meetup links get neutral share data", async () => {
  for (const row of [{ ...event, members_only: true }, { ...event, members_only: null }, { ...event, slug: "another-crew" }, { ...event, id: "another-id" }]) {
    const h = harness({ crew_event_detail: { data: [row], error: null } });
    assert.equal(await h.getPublicEvent("loop8", id), null);
  }
});

test("non-public crews, errors and invalid dates get the neutral fallback", async () => {
  for (const response of [{ data: [{ ...crew, crew_status: "pending" }], error: null }, { data: [], error: null }, { data: [crew], error: { message: "denied" } }, new Error("offline")]) {
    const h = harness({ crew_overview: response });
    assert.equal(await h.getPublicCrew("loop8"), null);
  }
  const h = harness({ crew_event_detail: { data: [{ ...event, starts_at: "invalid" }], error: null } });
  assert.equal(await h.getPublicEvent("loop8", id), null);
});

test("malformed event ids do not query the API", async () => {
  const h = harness();
  assert.equal(await h.getPublicEvent("loop8", "invalid"), null);
  assert.deepEqual(h.calls, []);
});
