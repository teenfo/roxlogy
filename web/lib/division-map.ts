// HYROX 디비전 분류 — **단일 출처**.
//
// 이전에는 네 곳이 각자 다르게 판정했다. 결과 API 경로는 모든 RELAY 를 'relay' 로
// 접었고, 텍스트 붙여넣기 경로만 'mixed_relay' 를 남겼으며, 대회 통계 매칭은 성별을
// 아예 보지 않았다. 그래서 같은 믹스 릴레이 기록이 저장 경로에 따라 다른 코드로
// 들어갔고, 믹스 디비전은 백분위·통계 매칭에서 조용히 빠졌다.
//
// 확정 규칙 — 이름으로 기본 디비전을 정하고, 성별 값이 혼성이면 믹스로 승격한다:
//   HYROX DOUBLES + sex=X  → mixed_doubles
//   HYROX TEAM RELAY + sex=X → mixed_relay
// HYROX 이벤트 이름에는 MIXED 가 없는 경우가 많아(예: 믹스 더블도 그냥
// "HYROX DOUBLES") 성별 판정이 필수다. 이름에 MIXED 가 들어 있으면 그것도 존중한다.
//
// scripts/sync-race-benchmarks.mjs·sync-athlete-results.mjs 에도 같은 규칙이
// 복제돼 있다(스크립트는 .mjs 라 이 모듈을 import 할 수 없다). 규칙을 바꾸면
// 그쪽도 함께 고칠 것.

import type { Division } from "./divisions";

/** 결과 행의 sex 값이 혼성(믹스)인가. M/W(F) 외에는 혼성으로 본다. */
export function isMixedSex(sex: string | null | undefined): boolean {
  const s = String(sex ?? "").toUpperCase().trim();
  if (!s) return false;
  if (/^(M|W|F|MALE|FEMALE)$/.test(s)) return false;
  return /^(X|MX)$/.test(s) || s.includes("MIX");
}

/** 디비전 이름/라벨 → 디비전 코드 (성별 정보 없음) */
export function divisionFromName(
  name: string | null | undefined,
): Division | null {
  const k = String(name ?? "").toUpperCase();
  if (!k) return null;
  if (/MIXED\s+DOUBLES/.test(k)) return "mixed_doubles";
  if (/MIXED\s+RELAY/.test(k)) return "mixed_relay";
  if (/PRO\s+DOUBLES/.test(k)) return "pro_doubles";
  if (/DOUBLES/.test(k)) return "doubles";
  if (/RELAY/.test(k)) return "relay";
  if (/PRO/.test(k)) return "pro";
  if (/HYROX/.test(k)) return "open";
  return null;
}

/** 기본 디비전을 혼성 성별로 승격 (doubles→mixed_doubles, relay→mixed_relay) */
export function toMixed(division: Division | null): Division | null {
  if (division === "doubles") return "mixed_doubles";
  if (division === "relay") return "mixed_relay";
  return division;
}

/** 이름 + 성별 → 최종 디비전 코드. 결과 API 경로는 항상 이걸 쓸 것. */
export function resolveDivision(
  name: string | null | undefined,
  sex?: string | null,
): Division | null {
  const base = divisionFromName(name);
  return isMixedSex(sex) ? toMixed(base) : base;
}

/** 사람이 붙여넣은 결과 텍스트 한 줄 → 디비전 코드.
 *  공식 라벨이 아니라 자유 텍스트라 'mixed' 키워드를 직접 본다. */
export function divisionFromText(line: string): Division | null {
  const mixed = /\bmixed\b/i.test(line);
  if (/pro\s*doubles/i.test(line)) return "pro_doubles";
  if (/\bdoubles\b/i.test(line)) return mixed ? "mixed_doubles" : "doubles";
  if (/\brelay\b/i.test(line)) return mixed ? "mixed_relay" : "relay";
  if (/\bpro\b/i.test(line)) return "pro";
  if (/\bopen\b/i.test(line)) return "open";
  return null;
}
