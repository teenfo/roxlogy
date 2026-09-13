"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Dialog } from "@/components/ui/dialog";
import {
  CARD_SIZE,
  CARD_WEIGHTS,
  cardFileName,
  cardText,
  DEFAULT_PLACEMENT,
  drawRecordCard,
  suggestFit,
  type CardRatio,
  type CardTheme,
  type PhotoPlacement,
  type RecordCardData,
} from "@/lib/record-card";

/**
 * 기록지 내려받기 — 사진을 올리면 그 위에 기록을 얹어 PNG 한 장을 만든다.
 *
 * **올린 사진은 저장하지 않는다.** 파일은 브라우저 밖으로 나가지 않는다:
 * File → createImageBitmap → canvas → toBlob → objectURL → <a download>.
 * 서버 라우트도 Storage 도 쓰지 않으므로 네트워크 요청 자체가 없다. 다이얼로그를
 * 닫으면 비트맵과 objectURL 을 즉시 해제한다.
 */
export function RecordCardButton({
  data,
  className = "",
  label,
}: {
  data: RecordCardData;
  className?: string;
  /** 버튼 문구 — 기본은 "기록지" */
  label?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState<CardRatio>("9:16");
  const [theme, setTheme] = useState<CardTheme>("dark");
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const [place, setPlace] = useState<PhotoPlacement>(DEFAULT_PLACEMENT);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 워드마크는 public 의 SVG 를 한 번 받아 캔버스에 그린다. 실패해도(=null) 카드는 나온다.
  const [mark, setMark] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!open || mark) return;
    const img = new Image();
    img.onload = () => setMark(img);
    img.src = "/roxlogy-mark.svg";
  }, [open, mark]);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    drawRecordCard(c, data, ratio, photo, mark, theme, place);
  }, [data, ratio, photo, mark, theme, place]);

  // 먼저 한 번 그리고(시스템 글꼴), 필요한 글꼴 조각을 받은 뒤 다시 그린다.
  // 캔버스 텍스트는 unicode-range 서브셋 로딩을 스스로 유발하지 못해서, 카드에 들어갈
  // 글자를 통째로 넘겨야 그 조각만 받아 온다. 실패해도 시스템 글꼴로 그려질 뿐이다.
  useEffect(() => {
    if (!open) return;
    redraw();
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts) return;
    let cancelled = false;
    const text = cardText(data);
    void Promise.all(
      CARD_WEIGHTS.map((wt) =>
        fonts.load(`${wt} 100px "Pretendard Variable"`, text).catch(() => []),
      ),
    ).then(() => {
      if (!cancelled) redraw();
    });
    return () => {
      cancelled = true;
    };
  }, [open, redraw, data]);

  // 닫을 때 비트맵을 놓아준다 — 사진을 메모리에 붙들고 있지 않는다
  function close() {
    setOpen(false);
    setPhoto((p) => {
      p?.close?.();
      return null;
    });
    setPlace(DEFAULT_PLACEMENT);
    setErr(null);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const bmp = await createImageBitmap(file);
      setPhoto((p) => {
        p?.close?.();
        return bmp;
      });
      // 가로 사진은 cover 로 넣으면 폭의 3분의 1만 남는다 — 통째로 넣는 쪽에서 시작한다
      setPlace({ ...DEFAULT_PLACEMENT, fit: suggestFit(bmp.width, bmp.height, ratio) });
    } catch {
      setErr(t("card.readFail"));
    }
  }

  async function download() {
    const c = canvasRef.current;
    if (!c) return;
    setBusy(true);
    try {
      const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/png"));
      if (!blob) {
        setErr(t("card.readFail"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = cardFileName(data, ratio);
      a.click();
      // 클릭 직후 해제하면 사파리에서 받기 전에 끊긴다 — 한 틱 뒤에 푼다
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(false);
    }
  }

  const { w, h } = CARD_SIZE[ratio];
  // 꽉 채운 사진만 움직일 게 있다. 맞추기는 통째로 들어가 있어 끌 이유가 없다.
  const canDrag = !!photo && place.fit === "cover";
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  function onDragStart(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canDrag) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: place.offsetX, oy: place.offsetY };
  }
  function onDragMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    // 미리보기 한 변을 끝까지 끌면 오프셋이 -1~1 을 다 훑는다
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    setPlace((p) => ({
      ...p,
      offsetX: clamp(d.ox - ((e.clientX - d.x) / r.width) * 2),
      offsetY: clamp(d.oy - ((e.clientY - d.y) / r.height) * 2),
    }));
  }
  function onDragEnd(e: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const chip =
    "rounded-full px-3 py-1 text-xs font-bold transition-colors disabled:opacity-40";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ||
          "rounded-md bg-background px-2.5 py-1 text-xs text-muted hover:text-foreground"
        }
      >
        {label ?? t("card.open")}
      </button>
      <Dialog
        open={open}
        onClose={close}
        label={t("card.title")}
        closeLabel={t("common.close")}
        panelClassName="max-w-md"
      >
        <div className="flex w-full flex-col gap-3 rounded-md bg-surface p-4">
          <p className="text-sm font-semibold">{t("card.title")}</p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110">
              {photo ? t("card.changePhoto") : t("card.pickPhoto")}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {photo && (
              <button
                type="button"
                onClick={() => {
                  setPhoto((p) => {
                    p?.close?.();
                    return null;
                  });
                  setPlace(DEFAULT_PLACEMENT);
                }}
                className={`${chip} bg-background text-muted hover:text-foreground`}
              >
                {t("card.removePhoto")}
              </button>
            )}
            <span className="ml-auto flex gap-1.5">
              {(["9:16", "1:1"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRatio(r)}
                  aria-pressed={ratio === r}
                  className={`${chip} ${
                    ratio === r
                      ? "bg-accent text-background"
                      : "bg-background text-muted hover:text-foreground"
                  }`}
                >
                  {r}
                </button>
              ))}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* 글자 밝기 — 밝은 배경·사진에 얹을 거면 라이트 */}
            {(["dark", "light"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTheme(k)}
                aria-pressed={theme === k}
                className={`${chip} ${
                  theme === k
                    ? "bg-accent text-background"
                    : "bg-background text-muted hover:text-foreground"
                }`}
              >
                {t(k === "dark" ? "card.themeDark" : "card.themeLight")}
              </button>
            ))}
            {/* 사진 넣는 방식 — 맞추기는 한 변도 자르지 않는다 */}
            {photo && (
              <span className="ml-auto flex gap-1.5">
                {(["cover", "fit"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() =>
                      setPlace((p) => ({ ...DEFAULT_PLACEMENT, fit: f, zoom: p.zoom }))
                    }
                    aria-pressed={place.fit === f}
                    className={`${chip} ${
                      place.fit === f
                        ? "bg-accent text-background"
                        : "bg-background text-muted hover:text-foreground"
                    }`}
                  >
                    {t(f === "cover" ? "card.fitCover" : "card.fitContain")}
                  </button>
                ))}
              </span>
            )}
          </div>

          <div className="flex justify-center rounded-md bg-background p-3">
            <canvas
              ref={canvasRef}
              width={w}
              height={h}
              aria-label={t("card.previewAlt")}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              className={`h-auto w-full max-w-[280px] self-start rounded ${
                canDrag ? "cursor-move touch-none" : ""
              }`}
              // 사진이 없으면 배경이 투명하다 — 체커보드로 그 사실을 보여 준다
              style={
                photo
                  ? undefined
                  : {
                      backgroundImage:
                        theme === "light"
                          ? "repeating-conic-gradient(#e8e8e6 0% 25%, #cfcfcc 0% 50%)"
                          : "repeating-conic-gradient(#2b2b2b 0% 25%, #1b1b1b 0% 50%)",
                      backgroundSize: "18px 18px",
                    }
              }
            />
          </div>

          {canDrag && (
            <label className="flex items-center gap-3 text-[11px] text-muted">
              {t("card.zoom")}
              <input
                type="range"
                min={100}
                max={250}
                step={5}
                value={Math.round(place.zoom * 100)}
                onChange={(e) =>
                  setPlace((p) => ({ ...p, zoom: Number(e.target.value) / 100 }))
                }
                className="h-1 flex-1 accent-accent"
              />
              <button
                type="button"
                onClick={() => setPlace((p) => ({ ...p, zoom: 1, offsetX: 0, offsetY: 0 }))}
                className="text-muted hover:text-foreground"
              >
                {t("card.reset")}
              </button>
            </label>
          )}
          {err && (
            <p role="alert" className="text-xs text-red-400">
              {err}
            </p>
          )}
          <p className="text-[11px] text-muted">
            {!photo
              ? t("card.transparentNote")
              : canDrag
                ? t("card.dragHint")
                : t("card.fitHint")}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void download()}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
            >
              {t("card.download")}
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-md px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
