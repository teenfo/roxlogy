/**
 * 토큰 조합 대비 검사 (스펙 §11 기준: 일반 텍스트 4.5:1 / 큰 텍스트·비텍스트 3:1).
 *
 *   node scripts/check-contrast.mjs
 *
 * app/globals.css 의 시안 `:root` 토큰과, 시안이 클래스에 직접 박아 둔 색(칩·힌트·수입/지출·오류)을
 * 읽어 실제 화면에서 만나는 전경·배경 쌍만 검사한다. 통과 여부를 단정하기보다
 * **어떤 조합이 미달인지**를 드러내는 게 목적이다 — 자동 검사는 실제 화면의 조합을 전부 알지 못한다.
 * 라이트 단일 테마다(라이브보드만 다크 — 아래 BOARD 로 따로 본다).
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** 첫 `:root {` 블록 — 시안(shadcn) 토큰 */
function rootTokens() {
  const i = css.indexOf(":root {");
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  const out = {};
  for (const [, k, v] of css.slice(open, close).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}
/** 선택자의 첫 규칙 블록에서 color/background 를 읽는다 */
function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return {};
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  const body = css.slice(open, close);
  const pick = (p) => body.match(new RegExp(`(?:^|[\\s;])${p}:\\s*([^;!]+)`))?.[1]?.trim() ?? null;
  return { color: pick("color"), bg: pick("background") ?? pick("background-color") };
}

const T = rootTokens();
const hex = (v) => (v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
function lum(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const chip = (cls) => rule(`.rx-chip.${cls}`);
/** [이름, 전경 hex, 배경 hex, 최소비율, 설명] */
const PAIRS = [
  ["foreground / card", T.foreground, T.card, 4.5, "본문"],
  ["foreground / background", T.foreground, T.background, 4.5, "페이지 위 본문"],
  ["muted-foreground / card", T["muted-foreground"], T.card, 4.5, "보조 텍스트(시안 --muted-foreground)"],
  ["primary-foreground / primary", T["primary-foreground"], T.primary, 4.5, "브랜드 옐로 버튼 글자"],
  ["sidebar-foreground / sidebar", T["sidebar-foreground"], T.sidebar, 4.5, "사이드바 메뉴"],
  ["sidebar-accent-foreground / sidebar-accent", T["sidebar-accent-foreground"], T["sidebar-accent"], 4.5, "사이드바 활성 메뉴"],
  ["destructive / card", T.destructive, T.card, 4.5, "오류 문구(--destructive)"],
  ["rx-hint / card", rule(".rx-hint").color, T.card, 4.5, "힌트 문구"],
  ["rx-muted / card", rule(".rx-muted").color, T.card, 4.5, "보조 문구(.rx-muted)"],
  ["rx-eyebrow / background", rule(".rx-eyebrow").color, T.background, 3, "페이지 머리 아이브로(큰 자간·보조)"],
  ["rx-error / card", rule(".rx-error").color, T.card, 4.5, "폼 오류"],
  ["rx-income / card", rule(".rx-income").color, T.card, 4.5, "수입 금액"],
  ["rx-expense / card", rule(".rx-expense").color, T.card, 4.5, "지출 금액"],
  ["chip.neutral", rule(".rx-chip").color, rule(".rx-chip").bg, 4.5, "기본 칩"],
  ["chip.yellow", chip("yellow").color, chip("yellow").bg, 4.5, "옐로 칩"],
  ["chip.green", chip("green").color, chip("green").bg, 4.5, "그린 칩"],
  ["chip.blue", chip("blue").color, chip("blue").bg, 4.5, "블루 칩"],
  ["chip.red", chip("red").color, chip("red").bg, 4.5, "레드 칩(우리 확장)"],
  ["chip.tier-yellow", chip("tier-yellow").color, chip("tier-yellow").bg, 4.5, "등급 칩(옐로)"],
  ["chip.tier-blue", chip("tier-blue").color, chip("tier-blue").bg, 4.5, "등급 칩(블루)"],
  ["chip.tier-chalk", chip("tier-chalk").color, chip("tier-chalk").bg, 4.5, "등급 칩(초크)"],
  ["chip.tier-gray", chip("tier-gray").color, chip("tier-gray").bg, 4.5, "등급 칩(회색)"],
  ["chip.tier-green", chip("tier-green").color, chip("tier-green").bg, 4.5, "등급 칩(그린)"],
  ["chip.tier-red", chip("tier-red").color, chip("tier-red").bg, 4.5, "등급 칩(레드)"],
  ["border / card", T.border, T.card, 3, "카드 경계(장식)"],
  ["input / card", T.input, T.card, 3, "입력 경계(비텍스트)"],
  ["ring / card", T.ring, T.card, 3, "포커스 링(비텍스트)"],
  ["primary / card", T.primary, T.card, 3, "브랜드 옐로 면(비텍스트)"],
  ["chart-1 / card", T["chart-1"], T.card, 3, "차트 시리즈 1"],
  ["chart-2 / card", T["chart-2"], T.card, 3, "차트 시리즈 2"],
  ["chart-3 / card", T["chart-3"], T.card, 3, "차트 시리즈 3"],
  ["chart-4 / card", T["chart-4"], T.card, 3, "차트 시리즈 4"],
  ["chart-5 / card", T["chart-5"], T.card, 3, "차트 시리즈 5"],
];

/** 의도된 예외 — 대비만으로 판단하면 안 되는 조합 */
const EXEMPT = {
  "border / card": "장식용 경계다. 카드는 회색 페이지 위의 흰 면으로도 구분되므로 경계가 유일한 식별 수단이 아니다.",
  "input / card": "입력 경계. 라벨·플레이스홀더·포커스 링이 함께 있어 경계만으로 식별하지 않는다.",
  "primary / card": "브랜드 옐로 면. 늘 어두운 글자(10.06:1)와 짝지어 쓰고, 색만으로 뜻을 전달하지 않는다.",
  "rx-eyebrow / background": "장식용 아이브로(ROXLOGY / PERFORMANCE LAB). 바로 아래 h1 이 같은 내용을 말한다.",
};

let fail = 0;
const rows = [];
for (const [name, fgRaw, bgRaw, min, label] of PAIRS) {
  const a = hex(fgRaw);
  const b = hex(bgRaw);
  if (!a || !b) {
    rows.push([name, "—", "값 없음", label]);
    continue;
  }
  const r = ratio(a, b);
  const exempt = EXEMPT[name];
  const ok = r >= min || !!exempt;
  if (!ok) fail++;
  const verdict = r >= min ? "ok" : exempt ? "허용 예외" : `미달 (<${min})`;
  rows.push([name, r.toFixed(2), verdict, label]);
}

console.log("테마: light (시안 :root)\n");
for (const [pair, r, verdict, label] of rows) {
  const mark = verdict === "ok" ? " " : "!";
  console.log(`${mark} ${pair.padEnd(44)} ${String(r).padStart(6)}  ${verdict.padEnd(12)} ${label}`);
}
console.log(`\n${rows.length}개 조합 · 미달 ${fail}개 · 허용 예외 ${Object.keys(EXEMPT).length}개`);
for (const [k, why] of Object.entries(EXEMPT)) console.log(`  ${k}: ${why}`);

// 브랜드 규칙: 옐로는 밝은 면에서 글자로 쓰지 않는다
const y = ratio(T.primary, T.card);
console.log(`\n브랜드 옐로 ${T.primary} vs 카드 ${T.card} = ${y.toFixed(2)}:1 → 텍스트 금지(면·버튼 배경 전용).`);

// 라이브보드(다크 섬) — .rx-live-board 의 배경 위 글자
const board = rule(".rx-live-board");
if (board.bg && board.color && hex(board.bg) && hex(board.color)) {
  console.log(`라이브보드 글자 ${board.color} vs 배경 ${board.bg} = ${ratio(board.color, board.bg).toFixed(2)}:1`);
}
process.exitCode = fail ? 1 : 0;
