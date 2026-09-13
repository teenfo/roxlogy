"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Dialog } from "@/components/ui/dialog";
import {
  CARD_SIZE,
  cardFileName,
  drawRecordCard,
  type CardRatio,
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
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
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
    drawRecordCard(c, data, ratio, photo, mark);
  }, [data, ratio, photo, mark]);

  useEffect(() => {
    if (open) redraw();
  }, [open, redraw]);

  // 닫을 때 비트맵을 놓아준다 — 사진을 메모리에 붙들고 있지 않는다
  function close() {
    setOpen(false);
    setPhoto((p) => {
      p?.close?.();
      return null;
    });
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
                onClick={() =>
                  setPhoto((p) => {
                    p?.close?.();
                    return null;
                  })
                }
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

          <div className="flex justify-center rounded-md bg-background p-3">
            <canvas
              ref={canvasRef}
              width={w}
              height={h}
              aria-label={t("card.previewAlt")}
              className="h-auto w-full max-w-[280px] rounded"
            />
          </div>

          {err && (
            <p role="alert" className="text-xs text-red-400">
              {err}
            </p>
          )}
          <p className="text-[11px] text-muted">{t("card.privacyNote")}</p>

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
