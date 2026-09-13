/**
 * 기록지(공유 카드) 그리기 — 사진 위에 기록을 얹어 PNG 한 장을 만든다.
 *
 * **업로드한 사진은 어디에도 저장되지 않는다.** 파일은 브라우저 안에서만 다룬다:
 * File → createImageBitmap → canvas → toBlob → objectURL → <a download>.
 * 서버로도 Supabase Storage 로도 보내지 않으므로 네트워크 요청이 아예 없다.
 *
 * 글꼴은 앱과 같은 Pretendard Variable(자체 호스팅, app/fonts.css)이다. 다만 캔버스
 * 텍스트는 unicode-range 서브셋 로딩을 스스로 유발하지 못하므로, 그리기 전에
 * cardText() 로 모은 문자열을 document.fonts.load() 에 넘겨 필요한 조각을 먼저
 * 받아야 한다 — 안 그러면 첫 그림만 시스템 글꼴로 나온다.
 */

export type CardRatio = "9:16" | "1:1";

export const CARD_SIZE: Record<CardRatio, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
};

export type CardSplit = {
  label: string;
  value: string;
  /** 종목 색 — PFT 는 PFT_COLORS, 나머지는 생략 */
  color?: string;
};

export type RecordCardData = {
  /** 상단 작은 글씨 — "PFT" · "HYROX SIM" 같은 종류 표시 */
  kind: string;
  /** 선수 이름 */
  athlete: string;
  /** 날짜 · 장소 · 부문 등 한 줄 */
  subtitle: string;
  /** 큰 숫자 위의 라벨 — "총 시간" */
  mainLabel: string;
  /** 큰 숫자 — "24:31" */
  mainValue: string;
  /** 배지 칩 (PFT 골드·실버·브론즈). 없으면 생략 */
  badge?: { text: string; tone: "gold" | "silver" | "bronze" };
  /** 구간 기록 — 6칸까지는 한 줄, 넘으면 두 줄 */
  splits?: CardSplit[];
  /** 하단 보조 지표 — "평균 심박 158" 같은 것 */
  stats?: { label: string; value: string }[];
};

const CHALK = "#F4F4F2";
const BLACK = "#141414";
const YELLOW = "#FFD500";
const MUTED = "rgba(244,244,242,0.62)";

const BADGE_TONE = {
  gold: { bg: "#FFD500", fg: BLACK },
  silver: { bg: "#D9D9D9", fg: BLACK },
  bronze: { bg: "#C98150", fg: BLACK },
} as const;

/** 앱 본문과 같은 스택 — globals.css 의 body font-family 와 맞춘다 */
const STACK =
  '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", Roboto, sans-serif';

function font(size: number, weight: number | string = 400): string {
  return `${weight} ${size}px ${STACK}`;
}

/** 사진을 칸에 꽉 채워 그린다(잘라내기 — 늘리지 않는다) */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 폭에 맞을 때까지 글자 크기를 줄인다 — 긴 이름·대회명이 넘치지 않게 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  weight: number | string,
): number {
  let s = size;
  ctx.font = font(s, weight);
  while (s > 14 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(s, weight);
  }
  return s;
}

/**
 * 카드 한 장을 그린다. photo 가 null 이면 검정 바탕에 기록만 올린다
 * (사진 없이도 쓸 수 있어야 한다 — 현장에서 사진을 안 찍은 경우).
 */
export function drawRecordCard(
  canvas: HTMLCanvasElement,
  data: RecordCardData,
  ratio: CardRatio,
  photo: (CanvasImageSource & { width: number; height: number }) | null,
  mark: CanvasImageSource | null,
) {
  const { w, h } = CARD_SIZE[ratio];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, w, h);
  if (photo) drawCover(ctx, photo, w, h);

  // 아래쪽 어둡게 — 사진이 밝아도 글자가 읽혀야 한다
  const scrim = ctx.createLinearGradient(0, h * 0.32, 0, h);
  scrim.addColorStop(0, "rgba(20,20,20,0)");
  scrim.addColorStop(0.45, "rgba(20,20,20,0.72)");
  scrim.addColorStop(1, "rgba(20,20,20,0.96)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, h * 0.32, w, h * 0.68);
  // 상단도 살짝 — 워드마크 자리
  const top = ctx.createLinearGradient(0, 0, 0, 220);
  top.addColorStop(0, "rgba(20,20,20,0.55)");
  top.addColorStop(1, "rgba(20,20,20,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, 220);

  const pad = 72;
  const inner = w - pad * 2;

  // 워드마크 (좌상단)
  let markRight = pad;
  if (mark) {
    const size = 56;
    ctx.drawImage(mark, pad, pad - 4, size, size);
    markRight = pad + size + 16;
  }
  ctx.fillStyle = CHALK;
  ctx.font = font(30, 800);
  ctx.textBaseline = "top";
  ctx.fillText("ROXLOGY", markRight, pad + 10);

  // 종류 (우상단)
  ctx.font = font(24, 700);
  ctx.fillStyle = YELLOW;
  ctx.textAlign = "right";
  ctx.fillText(data.kind.toUpperCase(), w - pad, pad + 14);
  ctx.textAlign = "left";

  // ── 아래에서 위로 쌓는다 ───────────────────────────────────────────────
  let y = h - pad;
  ctx.textBaseline = "bottom";

  // 보조 지표
  if (data.stats?.length) {
    const gap = 40;
    let x = pad;
    ctx.textBaseline = "bottom";
    for (const s of data.stats) {
      ctx.font = font(26, 700);
      const vw = ctx.measureText(s.value).width;
      ctx.font = font(22, 500);
      const lw = ctx.measureText(s.label).width;
      if (x + vw + lw + 12 > w - pad) break;
      ctx.fillStyle = MUTED;
      ctx.font = font(22, 500);
      ctx.fillText(s.label, x, y);
      ctx.fillStyle = CHALK;
      ctx.font = font(26, 700);
      ctx.fillText(s.value, x + lw + 12, y);
      x += lw + vw + 12 + gap;
    }
    y -= 52;
  }

  // 구간 기록 — 색 막대 + 시간, 한 줄에 최대 6칸
  if (data.splits?.length) {
    const perRow = Math.min(6, data.splits.length);
    const rows: CardSplit[][] = [];
    for (let i = 0; i < data.splits.length; i += perRow) {
      rows.push(data.splits.slice(i, i + perRow));
    }
    for (const row of [...rows].reverse()) {
      const gap = 12;
      const cw = (inner - gap * (perRow - 1)) / perRow;
      const rowTop = y - 84;
      row.forEach((s, i) => {
        const x = pad + i * (cw + gap);
        ctx.fillStyle = "rgba(244,244,242,0.10)";
        roundRect(ctx, x, rowTop, cw, 84, 14);
        ctx.fill();
        if (s.color) {
          ctx.fillStyle = s.color;
          roundRect(ctx, x, rowTop, cw, 6, 3);
          ctx.fill();
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = MUTED;
        const ls = fitText(ctx, s.label, cw - 16, 20, 600);
        ctx.font = font(ls, 600);
        ctx.fillText(s.label, x + cw / 2, rowTop + 18);
        ctx.fillStyle = CHALK;
        const vs = fitText(ctx, s.value, cw - 16, 30, 800);
        ctx.font = font(vs, 800);
        ctx.fillText(s.value, x + cw / 2, rowTop + 44);
      });
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      y = rowTop - 14;
    }
    y -= 10;
  }

  // 큰 기록 + 배지
  ctx.textBaseline = "bottom";
  const mainSize = fitText(ctx, data.mainValue, inner - 220, 148, 800);
  ctx.font = font(mainSize, 800);
  ctx.fillStyle = CHALK;
  ctx.fillText(data.mainValue, pad, y);
  const mainWidth = ctx.measureText(data.mainValue).width;

  if (data.badge) {
    const tone = BADGE_TONE[data.badge.tone];
    ctx.font = font(28, 800);
    const tw = ctx.measureText(data.badge.text).width;
    const bw = tw + 44;
    const bh = 52;
    const bx = pad + mainWidth + 24;
    const by = y - bh - Math.round(mainSize * 0.14);
    ctx.fillStyle = tone.bg;
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = tone.fg;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(data.badge.text, bx + bw / 2, by + bh / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
  }
  y -= mainSize + 6;

  // 라벨
  ctx.font = font(26, 600);
  ctx.fillStyle = YELLOW;
  ctx.fillText(data.mainLabel, pad, y);
  y -= 42;

  // 부제 (날짜 · 장소)
  if (data.subtitle) {
    const ss = fitText(ctx, data.subtitle, inner, 28, 500);
    ctx.font = font(ss, 500);
    ctx.fillStyle = MUTED;
    ctx.fillText(data.subtitle, pad, y);
    y -= 44;
  }

  // 이름
  const ns = fitText(ctx, data.athlete, inner, 64, 800);
  ctx.font = font(ns, 800);
  ctx.fillStyle = CHALK;
  ctx.fillText(data.athlete, pad, y);
}

/** 카드에 그려지는 모든 글자 — document.fonts.load() 에 넘겨 필요한 서브셋만 받는다 */
export function cardText(data: RecordCardData): string {
  return [
    "ROXLOGY",
    data.kind.toUpperCase(),
    data.athlete,
    data.subtitle,
    data.mainLabel,
    data.mainValue,
    data.badge?.text ?? "",
    ...(data.splits ?? []).flatMap((s) => [s.label, s.value]),
    ...(data.stats ?? []).flatMap((s) => [s.label, s.value]),
    "—",
  ].join(" ");
}

/** 카드가 쓰는 굵기 — 하나라도 빠지면 그 줄만 시스템 글꼴로 나온다 */
export const CARD_WEIGHTS = [400, 500, 600, 700, 800] as const;

/** 파일명 — 공백·경로 문자를 지운다 */
export function cardFileName(data: RecordCardData, ratio: CardRatio): string {
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return `roxlogy-${safe(data.kind)}-${safe(data.mainValue)}-${ratio.replace(":", "x")}.png`;
}
