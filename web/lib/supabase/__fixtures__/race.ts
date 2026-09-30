/** Fixture-only RPC contract for browser regression; never aliases a production build. */
import { FIXTURE_USER_ID } from "./mock-user";
import type { BoardData, MyEntry } from "@/lib/pft-race";
import type { RaceFormat } from "@/lib/race-format";

const fixtures = [
  { code: "PFT006", format: "pft" as RaceFormat, checkpoints: 6, title: "PFT regression" },
  ...[16, 24, 32].map((n) => ({ code: `SIM0${n}`, format: "hyrox_sim" as RaceFormat, checkpoints: n, title: `Simulation ${n}` })),
];
const boards = new Map<string, BoardData>();
const sessionId = "00000000-0000-4000-8000-000000000901";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function boardFor(code: string) {
  const fixture = fixtures.find((r) => r.code === code);
  if (!fixture) return null;
  if (!boards.has(code)) {
    const n = fixture.checkpoints;
    const started = new Date(Date.now() - 3_600_000).toISOString();
    boards.set(code, {
      race: { ...fixture, id: id(800 + n), status: "open", crew: "LOOP8", crew_slug: "loop8", created_at: "2026-09-29T00:00:00Z", join_open: true },
      server_now: new Date().toISOString(),
      entries: [
        { entry_id: id(100 + n), user_id: FIXTURE_USER_ID, name: "Fixture runner", started_at: started, splits: Array.from({ length: n > 6 ? n - 2 : 1 }, (_, i) => (i + 1) * 60000), finished_at: null, total_ms: null, scaled: false, badge: null, wave: 1, dnf_at: null },
        { entry_id: id(200 + n), user_id: id(202), name: "Finished runner", started_at: started, splits: Array.from({ length: n }, (_, i) => (i + 1) * 120000), finished_at: new Date().toISOString(), total_ms: n * 120000, scaled: false, badge: n === 6 ? "gold" : null, wave: 1, dnf_at: null },
        { entry_id: id(300 + n), user_id: id(203), name: "Waiting runner", started_at: null, splits: [], finished_at: null, total_ms: null, scaled: false, badge: null, wave: 2, dnf_at: null },
      ],
    });
  }
  const board = boards.get(code)!;
  board.server_now = new Date().toISOString();
  return board;
}

const saved = new Map<string, string | null>();
function myEntry(board: BoardData, index = 0): MyEntry {
  const e = board.entries[index];
  return { ...e, race_id: board.race.id, status: board.race.status, session_id: saved.get(e.entry_id) ?? null, result_id: e.finished_at && board.race.format === "pft" ? id(902) : null };
}

export function fixtureRaces() {
  return fixtures.map((f) => ({ ...boardFor(f.code)!.race, crews: { name: "LOOP8" }, entries: 3, joined: true }));
}

export function fixtureRaceRpc(name: string, args: Record<string, unknown> = {}): unknown {
  if (name === "pft_race_joinable" || name === "pft_race_admin_list") return fixtureRaces();
  if (name === "pft_race_create") {
    const code = args.p_format === "hyrox_sim" ? `SIM0${args.p_checkpoints}` : "PFT006";
    return { ok: true, code };
  }
  const byCode = typeof args.p_code === "string" ? boardFor(args.p_code.toUpperCase()) : null;
  const board = byCode ?? fixtures.map((f) => boardFor(f.code)).find((b) => b?.race.id === args.p_race);
  if (!board) return undefined;
  if (name === "pft_race_board") return board;
  if (name === "pft_race_can_manage") return true;
  if (name === "pft_race_join") return { ok: true, code: board.race.code };
  if (name === "pft_race_my_entry") return myEntry(board);
  const index = args.p_entry ? board.entries.findIndex((e) => e.entry_id === args.p_entry) : 0;
  const e = board.entries[index];
  if (!e) return { error: "not_joined" };
  if (name.endsWith("_split")) {
    e.splits = [...e.splits, Number(args.p_elapsed_ms)];
    if (e.splits.length === board.race.checkpoints) {
      e.finished_at = new Date().toISOString();
      e.total_ms = Number(args.p_elapsed_ms);
      saved.set(e.entry_id, board.race.format === "hyrox_sim" && e.total_ms >= 1_800_000 ? sessionId : null);
    }
    return myEntry(board, index);
  }
  if (name.endsWith("_undo")) {
    e.splits = e.splits.slice(0, -1); e.finished_at = null; e.total_ms = null; saved.set(e.entry_id, null);
    return myEntry(board, index);
  }
  if (name === "pft_race_staff_start") {
    const selected = board.entries.filter((e) => Array.isArray(args.p_entries) && args.p_entries.includes(e.entry_id));
    for (const e of selected) e.started_at = new Date().toISOString();
    return { ok: true, started: selected.length, server_now: new Date().toISOString() };
  }
  return undefined;
}
