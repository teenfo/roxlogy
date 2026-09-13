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

/** 밝은 배경에 얹을 거면 "light" — 글자를 어둡게 바꾸고 사진 스크림도 흰색으로 깐다.
 *  투명 배경 카드는 어디에 얹힐지 알 수 없어서 두 벌이 필요하다(2026-09-14). */
export type CardTheme = "dark" | "light";

/**
 * 사진을 칸에 넣는 방식.
 * - "cover": 꽉 채우고 넘치는 만큼 잘라낸다. 어디를 남길지는 place 로 정한다.
 * - "fit": 사진을 통째로 넣고(잘림 없음) 남는 자리는 같은 사진을 크게 흐린 것으로 채운다.
 *   9:16 카드에 가로 사진을 넣으면 cover 로는 가로 폭의 1/3 만 남아서, 가로 사진은
 *   이쪽이 기본이다 (2026-09-14).
 */
export type CardFit = "cover" | "fit";

export type PhotoPlacement = {
  fit: CardFit;
  /** cover 확대율 — 1 이면 딱 채우는 크기 */
  zoom: number;
  /** 잘려 나가는 폭 대비 -1~1. 0 이 가운데 */
  offsetX: number;
  offsetY: number;
};

export const DEFAULT_PLACEMENT: PhotoPlacement = {
  fit: "cover",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

/** 사진이 칸보다 가로로 넓으면 잘라내기보다 통째로 넣는 편이 낫다 */
export function suggestFit(photoW: number, photoH: number, ratio: CardRatio): CardFit {
  const { w, h } = CARD_SIZE[ratio];
  return photoW / photoH > (w / h) * 1.1 ? "fit" : "cover";
}

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

type Palette = {
  /** 본문 글자 */
  ink: string;
  /** 부제·구간 라벨 */
  muted: string;
  /** 강조 글자(종목·큰 기록 라벨). 라이트에서는 흰 바탕에 Race Yellow 가 읽히지 않아
   *  앱이 이미 쓰고 있는 어두운 금색을 쓴다. */
  accent: string;
  /** 구간 칩 바탕 */
  chip: string;
  /** 글자 그림자 — 배경이 어떤 색일지 모르니 반대색으로 윤곽만 잡는다 */
  shadow: string;
  /** 사진 위 스크림의 바탕색 (r,g,b) */
  scrim: string;
};

const PALETTE: Record<CardTheme, Palette> = {
  dark: {
    ink: CHALK,
    muted: "rgba(244,244,242,0.62)",
    accent: YELLOW,
    chip: "rgba(244,244,242,0.10)",
    shadow: "rgba(0,0,0,0.55)",
    scrim: "20,20,20",
  },
  light: {
    ink: BLACK,
    muted: "rgba(20,20,20,0.58)",
    accent: "#8a7a2a",
    chip: "rgba(20,20,20,0.07)",
    shadow: "rgba(255,255,255,0.7)",
    scrim: "244,244,242",
  },
};

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

type Img = CanvasImageSource & { width: number; height: number };

/** 사진을 칸에 꽉 채워 그린다(잘라내기 — 늘리지 않는다).
 *  place 의 offset 은 "잘려 나가는 폭의 몇 %를 어느 쪽으로 밀지"다. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: Img,
  w: number,
  h: number,
  place: PhotoPlacement = DEFAULT_PLACEMENT,
) {
  const zoom = Math.max(1, Math.min(3, place.zoom || 1));
  const scale = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v || 0));
  const x = (w - dw) / 2 + (clamp(place.offsetX) * (dw - w)) / 2;
  const y = (h - dh) / 2 + (clamp(place.offsetY) * (dh - h)) / 2;
  ctx.drawImage(img, x, y, dw, dh);
}

/** 캔버스 필터(블러) 를 쓸 수 있는지. 사파리 구버전은 무시한다 */
function canBlur(ctx: CanvasRenderingContext2D): boolean {
  const before = ctx.filter;
  ctx.filter = "blur(2px)";
  const ok = ctx.filter !== "none" && ctx.filter !== before;
  ctx.filter = before;
  return ok;
}

/**
 * 사진을 통째로 넣고(contain) 남는 자리는 같은 사진의 흐린 확대본으로 채운다.
 * 기록 블록이 아래를 덮으므로 사진은 위쪽 band 안에서 가운데 정렬한다.
 */
function drawFit(
  ctx: CanvasRenderingContext2D,
  img: Img,
  w: number,
  h: number,
  bandBottom: number,
  scrimRgb: string,
) {
  // 배경 — 크게 키워 흐리게. 블러가 안 되면 조금 더 어둡게만 깐다.
  const blur = canBlur(ctx);
  if (blur) ctx.filter = `blur(${Math.round(w / 22)}px)`;
  drawCover(ctx, img, w, h, { fit: "cover", zoom: 1.25, offsetX: 0, offsetY: 0 });
  if (blur) ctx.filter = "none";
  ctx.fillStyle = `rgba(${scrimRgb},${blur ? 0.3 : 0.55})`;
  ctx.fillRect(0, 0, w, h);

  // 사진 원본 — 한 변도 자르지 않는다
  const scale = Math.min(w / img.width, bandBottom / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (bandBottom - dh) / 2, dw, dh);
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
 * 카드 한 장을 그린다.
 *
 * photo 가 null 이면 **배경을 투명하게 둔다** — 스토리 배경이나 다른 이미지 위에
 * 그대로 얹을 수 있어야 한다(2026-09-14 요청). 바탕을 칠하지 않으니 사진용 스크림도
 * 걸지 않는다. PNG 로 저장하므로 알파가 그대로 남는다.
 */
export function drawRecordCard(
  canvas: HTMLCanvasElement,
  data: RecordCardData,
  ratio: CardRatio,
  photo: (CanvasImageSource & { width: number; height: number }) | null,
  mark: CanvasImageSource | null,
  theme: CardTheme = "dark",
  place: PhotoPlacement = DEFAULT_PLACEMENT,
) {
  const pal = PALETTE[theme];
  const { w, h } = CARD_SIZE[ratio];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);
  if (photo) {
    if (place.fit === "fit") {
      // 기록 블록이 차지하는 아래쪽을 빼고 그 위에서 가운데 정렬한다
      drawFit(ctx, photo, w, h, h * (ratio === "9:16" ? 0.64 : 0.52), pal.scrim);
    } else {
      drawCover(ctx, photo, w, h, place);
    }
    // 아래쪽 어둡게 — 사진이 밝아도 글자가 읽혀야 한다. 투명 배경에는 걸지 않는다:
    // 검은 반투명이 남아 "투명"이 아니게 된다.
    const scrim = ctx.createLinearGradient(0, h * 0.32, 0, h);
    scrim.addColorStop(0, `rgba(${pal.scrim},0)`);
    scrim.addColorStop(0.45, `rgba(${pal.scrim},0.72)`);
    scrim.addColorStop(1, `rgba(${pal.scrim},0.96)`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, h * 0.32, w, h * 0.68);
  }

  const pad = 72;
  const inner = w - pad * 2;

  // 글자에 옅은 그림자. 배경이 투명하면 카드가 어디에 얹힐지 알 수 없고(밝은 배경 위면
  // Chalk 글자가 사라진다), 사진도 밝은 부분이 있다. 윤곽만 잡아 주는 정도로 둔다.
  ctx.shadowColor = pal.shadow;
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 2;

  // ── 아래에서 위로 쌓는다 ───────────────────────────────────────────────
  let y = h - pad;
  ctx.textBaseline = "bottom";

  // 워드마크 — 맨 아래. 기록을 먼저 읽히게 두고 브랜드는 받침으로 깐다.
  {
    const size = 40;
    let x = pad;
    if (mark) {
      ctx.drawImage(mark, x, y - size, size, size);
      x += size + 14;
    }
    ctx.fillStyle = pal.ink;
    ctx.font = font(26, 800);
    ctx.fillText("ROXLOGY", x, y - Math.round(size * 0.18));
    y -= size + 26;
  }

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
      ctx.fillStyle = pal.muted;
      ctx.font = font(22, 500);
      ctx.fillText(s.label, x, y);
      ctx.fillStyle = pal.ink;
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
        const shadow = ctx.shadowColor;
        ctx.shadowColor = "transparent";
        ctx.fillStyle = pal.chip;
        roundRect(ctx, x, rowTop, cw, 84, 14);
        ctx.fill();
        if (s.color) {
          ctx.fillStyle = s.color;
          roundRect(ctx, x, rowTop, cw, 6, 3);
          ctx.fill();
        }
        ctx.shadowColor = shadow;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = pal.muted;
        const ls = fitText(ctx, s.label, cw - 16, 20, 600);
        ctx.font = font(ls, 600);
        ctx.fillText(s.label, x + cw / 2, rowTop + 18);
        ctx.fillStyle = pal.ink;
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
  ctx.fillStyle = pal.ink;
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
  ctx.fillStyle = pal.accent;
  ctx.fillText(data.mainLabel, pad, y);
  y -= 42;

  // 부제 (날짜 · 장소)
  if (data.subtitle) {
    const ss = fitText(ctx, data.subtitle, inner, 28, 500);
    ctx.font = font(ss, 500);
    ctx.fillStyle = pal.muted;
    ctx.fillText(data.subtitle, pad, y);
    y -= 44;
  }

  // 이름 + 종목(이름 옆)
  const kind = data.kind.toUpperCase();
  ctx.font = font(26, 800);
  const kindWidth = ctx.measureText(kind).width;
  const ns = fitText(ctx, data.athlete, inner - kindWidth - 18, 64, 800);
  ctx.font = font(ns, 800);
  ctx.fillStyle = pal.ink;
  ctx.fillText(data.athlete, pad, y);
  const nameWidth = ctx.measureText(data.athlete).width;
  ctx.font = font(26, 800);
  ctx.fillStyle = pal.accent;
  ctx.fillText(kind, pad + nameWidth + 18, y - Math.round(ns * 0.08));
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
