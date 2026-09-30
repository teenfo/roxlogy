import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "../scripts/load-typescript.mjs";

const pft = loadTypeScript("lib/pft.ts");
const hyrox = loadTypeScript("lib/hyrox.ts");
const race = loadTypeScript("lib/race-format.ts", { "@/lib/pft": pft, "@/lib/hyrox": hyrox });
const ranking = loadTypeScript("lib/pft-race.ts", { "@/lib/avatar-color": { avatarColor: () => "#FFD500" } });

test("simulation modes match the 8-lap server and recorder contract", () => {
  for (const [count, pattern] of [[16, ["run", "station"]], [24, ["run", "roxzone", "station"]], [32, ["run", "roxzone", "station", "roxzone"]]]) {
    const cps = race.checkpointsFor("hyrox_sim", count);
    assert.equal(cps.length, count);
    assert.equal(new Set(cps.map((cp) => cp.key)).size, count);
    for (let lap = 1; lap <= 8; lap++) {
      const row = cps.filter((cp) => cp.lap === lap);
      assert.deepEqual(row.map((cp) => cp.kind), pattern);
      assert.equal(row.find((cp) => cp.kind === "station").stationKey, hyrox.STATIONS[lap - 1].key);
      if (count === 32) assert.deepEqual(row.filter((cp) => cp.kind === "roxzone").map((cp) => cp.roxSide), ["in", "out"]);
    }
  }
  assert.equal(race.raceBase("hyrox_sim"), "/timing");
  assert.equal(race.raceHome("hyrox_sim"), "/timing");
});

test("existing PFT and old RPC responses retain 6 stations and URLs", () => {
  for (const [format, count] of [[undefined, undefined], ["pft", 6], ["hyrox_sim", 99]]) {
    assert.deepEqual(race.checkpointsFor(format, count).map((cp) => cp.stationKey), pft.PFT_STATIONS.map((st) => st.key));
  }
  assert.equal(race.raceBase(undefined), "/pft/race");
  assert.equal(race.raceHome("pft"), "/pft");
});

test("ranking continues past PFT station 6, including hour clocks", () => {
  const entry = { entry_id: "one", user_id: "me", name: "Runner", started_at: "2026-09-29T00:00:00Z", splits: Array.from({ length: 19 }, (_, i) => (i + 1) * 60000), finished_at: null, total_ms: null, scaled: false, badge: null, wave: 1, dnf_at: null };
  assert.equal(ranking.rankEntries([entry], Date.parse("2026-09-29T01:00:00Z"), 32)[0].current, 19);
  assert.equal(ranking.rankEntries([{ ...entry, splits: [60000] }], Date.parse("2026-09-29T01:00:00Z"))[0].current, 1);
  assert.equal(ranking.fmtClock(3661234), "1:01:01.2");
  assert.equal(ranking.fmtClock(61234), "1:01.2");
});

test("CSV downloads preserve UTF-8 BOM, quotes, commas and null cells", async () => {
  let blob, clicked = false, revoked = false;
  const original = { document: globalThis.document, window: globalThis.window, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  try {
    globalThis.document = { createElement: () => ({ click: () => { clicked = true; } }) };
    globalThis.window = { setTimeout: (fn) => fn() };
    URL.createObjectURL = (value) => { blob = value; return "blob:fixture"; };
    URL.revokeObjectURL = () => { revoked = true; };
    loadTypeScript("lib/csv.ts").downloadCsv("roster.csv", ["이름", "메모"], [['한,글', 'a"b\nc'], [null, 2]]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
    assert.equal(await blob.text(), '"이름","메모"\r\n"한,글","a""b\nc"\r\n"","2"');
    assert.ok(clicked && revoked);
  } finally {
    globalThis.document = original.document;
    globalThis.window = original.window;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

test("roster export uses only displayed rows and omits withheld email columns", () => {
  let file;
  const t = (key) => key;
  const { CrewRosterDownload } = loadTypeScript("components/crew-roster-download.tsx", {
    "@/components/i18n-provider": { useI18n: () => ({ t, locale: "ko" }) },
    "@/components/ui/button": { Button: "button" },
    "@/lib/dict-label": { dictLabel: (_, __, fallback) => fallback },
    "@/lib/crew-role": loadTypeScript("lib/crew-role.ts"),
    "@/lib/csv": { downloadCsv: (name, head, rows) => { file = { name, head, rows }; } },
  });
  const member = { display_name: "Visible member", email: null, role: "member", tier_name: "Regular", division: "open", instagram: "athlete", joined_at: "2026-09-29T12:00:00Z", session_count: 4, attend_count: 8, attend_paid_count: 3 };
  CrewRosterDownload({ slug: "loop8", rows: [member] }).props.onClick();
  assert.equal(file.name, "loop8-roster-ko.csv");
  assert.equal(file.head.includes("crew.csvEmail"), false);
  assert.equal(file.rows.length, 1);
  assert.ok(file.rows[0].includes("@athlete"));
  assert.ok(file.rows[0].includes("2026-09-29"));
  assert.deepEqual(file.rows[0].slice(-3), [4, 8, 3]);
  CrewRosterDownload({ slug: "loop8", rows: [{ ...member, email: "staff-visible@example.test" }] }).props.onClick();
  assert.ok(file.head.includes("crew.csvEmail"));
  assert.ok(file.rows[0].includes("staff-visible@example.test"));
});
