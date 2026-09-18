/**
 * 토큰 조합 대비 검사 (스펙 §11 기준: 일반 텍스트 4.5:1 / 큰 텍스트·비텍스트 3:1).
 *
 *   node scripts/check-contrast.mjs [--theme light|dark]
 *
 * app/globals.css 의 :root / .theme-dark 값을 그대로 읽어 실제로 화면에서 만나는
 * 전경·배경 쌍만 검사한다. 통과 여부를 단정하기보다 **어떤 조합이 미달인지**를
 * 드러내는 게 목적이다 — 자동 검사는 실제 화면의 조합을 전부 알지 못한다.
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const theme = process.argv.includes("--theme")
  ? process.argv[process.argv.indexOf("--theme") + 1]
  : "light";

function block(selector) {
  const i = css.indexOf(selector);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  const out = {};
  // 키는 `--` 를 떼고 담는다 — 아래 PAIRS 가 토큰 이름만 쓴다
  for (const [, k, v] of css.slice(open, close).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[k] = v.trim();
  }
  return out;
}
const T = theme === "dark" ? block(".theme-dark {") : block(":root {");

const hex = (v) => (/^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
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

/** [전경, 배경, 최소비율, 설명] — 실제 화면에서 만나는 조합만 */
const PAIRS = [
  ["foreground", "card", 4.5, "본문"],
  ["foreground", "page", 4.5, "페이지 위 본문"],
  ["muted", "card", 4.5, "보조 텍스트"],
  ["muted-2", "card", 4.5, "보조 텍스트 2"],
  ["muted-3", "card", 4.5, "보조 텍스트 3·플레이스홀더"],
  ["foreground-2", "card", 4.5, "강조 본문"],
  ["accent-foreground", "accent", 4.5, "옐로 버튼 글자"],
  ["info", "info-bg", 4.5, "정보 칩"],
  ["success", "success-bg", 4.5, "완료 칩"],
  ["danger", "danger-bg", 4.5, "위험 칩"],
  ["label", "label-bg", 4.5, "분류 칩"],
  ["gold", "gold-bg", 4.5, "회비 배지"],
  ["accent-dim", "highlight", 4.5, "안내 영역"],
  ["warn", "warn-bg", 4.5, "지출 칩"],
  ["danger", "card", 4.5, "오류 문구"],
  ["success", "card", 4.5, "수입 금액"],
  ["info", "card", 4.5, "정보 문구"],
  ["gold", "card", 4.5, "강조 링크"],
  ["medal-silver", "card", 4.5, "은 배지"],
  ["medal-bronze", "card", 4.5, "동 배지"],
  // 허용 예외 2개 — 아래 EXEMPT 참고
  ["line", "card", 3, "카드 경계(장식)"],
  ["line-strong", "card", 3, "입력 경계(비텍스트)"],
  ["focus", "card", 3, "포커스 링(비텍스트)"],
  ["accent", "card", 3, "옐로 면(비텍스트)"],
  ["track", "card", 3, "트랙 블루(비텍스트)"],
  ["cat-sky", "card", 3, "차트 시리즈"],
  ["cat-lime", "card", 3, "차트 시리즈"],
  ["cat-violet", "card", 3, "차트 시리즈"],
  ["cat-pink", "card", 3, "차트 시리즈"],
  ["chart-green", "card", 3, "차트 시리즈"],
];

/** 의도된 예외 — 대비만으로 판단하면 안 되는 조합 */
const EXEMPT = {
  "line/card":
    "장식용 경계다. 카드는 회색 페이지 위의 흰 면으로도 구분되므로 경계가 유일한 식별 수단이 아니다.",
  "accent/card":
    "브랜드 옐로 면. 늘 어두운 글자(10.06:1)와 짝지어 쓰고, 색만으로 뜻을 전달하지 않는다.",
};

let fail = 0;
const rows = [];
for (const [fg, bg, min, label] of PAIRS) {
  const a = hex(T[fg]);
  const b = hex(T[bg]);
  if (!a || !b) {
    rows.push([`${fg} / ${bg}`, "—", "값 없음", label]);
    continue;
  }
  const r = ratio(a, b);
  const exempt = EXEMPT[`${fg}/${bg}`];
  const ok = r >= min || !!exempt;
  if (!ok) fail++;
  const verdict = r >= min ? "ok" : exempt ? "허용 예외" : `미달 (<${min})`;
  rows.push([`${fg} / ${bg}`, r.toFixed(2), verdict, label]);
}

console.log(`테마: ${theme}\n`);
for (const [pair, r, verdict, label] of rows) {
  const mark = verdict === "ok" ? " " : "!";
  console.log(`${mark} ${pair.padEnd(34)} ${String(r).padStart(6)}  ${verdict.padEnd(12)} ${label}`);
}
console.log(`\n${rows.length}개 조합 · 미달 ${fail}개 · 허용 예외 ${Object.keys(EXEMPT).length}개`);
for (const [k, why] of Object.entries(EXEMPT)) console.log(`  ${k}: ${why}`);

// 브랜드 규칙: 옐로는 밝은 면에서 글자로 쓰지 않는다
if (theme === "light") {
  const y = ratio(T.accent, T.card);
  console.log(
    `\n브랜드 옐로 ${T.accent} vs 카드 ${T.card} = ${y.toFixed(2)}:1 ` +
      `→ 텍스트 금지(면·버튼 배경 전용). 글자는 --gold 가 맡는다.`,
  );
}
process.exitCode = 0; // 보고용 — 빌드를 막지 않는다
