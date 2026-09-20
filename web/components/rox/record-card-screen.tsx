"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
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
import { Back, Field, PageHead, Panel } from "./ui";

/**
 * 기록 카드 공유 — 시안 record-card.tsx 의 RecordCardScreen 그대로 (PORT_PLAN §7-2 확정:
 * 상세 안 모달 대신 독립 화면). 합성은 lib/record-card.ts(시안과 동일 파일)로 브라우저
 * canvas 에서만 한다 — **사진은 서버·Storage 로 보내지 않는다**(CLAUDE.md).
 * 워드마크(브랜드 마크)는 public 의 SVG 를 한 번 받아 캔버스에 그린다.
 */
export function RecordCardScreen({
  data,
  back,
  athlete,
  dateLabel,
}: {
  data: Omit<RecordCardData, "athlete" | "subtitle"> & { subtitleParts: (string | null)[] };
  back: { href: string; label: string };
  /** 이름 표시를 켰을 때 넣을 이름 */
  athlete: string;
  /** 날짜 표시를 켰을 때 넣을 날짜 문구 */
  dateLabel: string | null;
}) {
  const { t } = useI18n();
  const [showName, setShowName] = useState(false);
  const [showDate, setShowDate] = useState(true);
  const [ratio, setRatio] = useState<CardRatio>("9:16");
  const [theme, setTheme] = useState<CardTheme>("dark");
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const [place, setPlace] = useState<PhotoPlacement>(DEFAULT_PLACEMENT);
  const [retry, setRetry] = useState(0);
  const [mark, setMark] = useState<HTMLImageElement | null>(null);
  // 렌더 결과는 "어떤 입력으로 그렸는가"와 함께 저장한다 — 입력이 바뀌면 자동으로
  // 준비 전 상태가 되므로 효과 안에서 setState 를 동기로 부를 일이 없다.
  const [done, setDone] = useState<{ key: string; error: boolean } | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const blob = useRef<Blob | null>(null);
  const fileVersion = useRef(0);

  const card: RecordCardData = {
    ...data,
    athlete: showName ? athlete : "",
    subtitle: [...data.subtitleParts, showDate ? dateLabel : null]
      .filter(Boolean)
      .join(" · "),
  };
  const key = JSON.stringify(card);
  const renderKey = [key, ratio, theme, JSON.stringify(place), retry, photo ? "p" : "", mark ? "m" : ""].join("|");
  const ready = done?.key === renderKey && !done.error;
  const error = photoError || (done?.key === renderKey && done.error);

  useEffect(() => {
    if (mark) return;
    const img = new Image();
    img.onload = () => setMark(img);
    img.src = "/roxlogy-mark.svg";
  }, [mark]);

  useEffect(
    () => () => {
      photo?.close();
    },
    [photo],
  );

  useEffect(() => {
    let active = true;
    blob.current = null;
    async function render() {
      try {
        // 캔버스 텍스트는 unicode-range 서브셋 로딩을 스스로 유발하지 못한다 —
        // 카드에 들어갈 글자를 통째로 넘겨 그 조각만 먼저 받는다.
        await document.fonts.ready;
        const text = cardText(card);
        await Promise.all(
          CARD_WEIGHTS.map((wt) =>
            document.fonts.load(`${wt} 100px "Pretendard Variable"`, text).catch(() => []),
          ),
        );
        if (!active || !canvas.current) return;
        drawRecordCard(canvas.current, card, ratio, photo, mark, theme, place);
        const output = await new Promise<Blob>((resolve, reject) =>
          canvas.current!.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
            "image/png",
          ),
        );
        if (active) {
          blob.current = output;
          setDone({ key: renderKey, error: false });
        }
      } catch {
        if (active) setDone({ key: renderKey, error: true });
      }
    }
    void render();
    return () => {
      active = false;
    };
    // card 는 renderKey 에 직렬화돼 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  async function selectPhoto(file?: File) {
    const version = ++fileVersion.current;
    setPhotoError(false);
    if (!file) {
      setPhoto(null);
      return;
    }
    try {
      const decoded = await createImageBitmap(file);
      if (version !== fileVersion.current) {
        decoded.close();
        return;
      }
      setPhoto(decoded);
      setPlace({
        ...DEFAULT_PLACEMENT,
        fit: suggestFit(decoded.width, decoded.height, ratio),
      });
    } catch {
      setPhotoError(true);
    }
  }

  function download() {
    if (!blob.current) return;
    const url = URL.createObjectURL(blob.current);
    const a = document.createElement("a");
    a.href = url;
    a.download = cardFileName(card, ratio);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="rx-completion">
      <Back href={back.href} label={back.label} />
      <PageHead title={t("share.title")} description={t("share.intro")} />
      <div className="rx-share-layout">
        <Panel>
          <div className="rx-form-grid">
            <Field label={t("share.ratio")}>
              <select value={ratio} onChange={(e) => setRatio(e.target.value as CardRatio)}>
                <option>9:16</option>
                <option>1:1</option>
              </select>
            </Field>
            <Field label={t("share.theme")}>
              <select value={theme} onChange={(e) => setTheme(e.target.value as CardTheme)}>
                <option value="dark">{t("share.dark")}</option>
                <option value="light">{t("share.light")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("share.photo")}>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => void selectPhoto(e.target.files?.[0])}
            />
          </Field>
          {photo && (
            <>
              <Button variant="outline" type="button" onClick={() => void selectPhoto()}>
                {t("share.removePhoto")}
              </Button>
              <Field label={t("share.fit")}>
                <select
                  value={place.fit}
                  onChange={(e) =>
                    setPlace((p) => ({ ...p, fit: e.target.value as "fit" | "cover" }))
                  }
                >
                  <option value="fit">{t("share.fitWhole")}</option>
                  <option value="cover">{t("share.fitCover")}</option>
                </select>
              </Field>
              {place.fit === "cover" &&
                (["zoom", "offsetX", "offsetY"] as const).map((k) => (
                  <Field key={k} label={t(`share.${k}`)}>
                    <input
                      type="range"
                      min={k === "zoom" ? 1 : -1}
                      max={k === "zoom" ? 3 : 1}
                      step="0.05"
                      value={place[k]}
                      onChange={(e) =>
                        setPlace((p) => ({ ...p, [k]: Number(e.target.value) }))
                      }
                    />
                  </Field>
                ))}
            </>
          )}
          <label className="rx-plan-check">
            <input
              type="checkbox"
              checked={showName}
              onChange={(e) => setShowName(e.target.checked)}
            />
            {t("share.showName")}
          </label>
          {dateLabel && (
            <label className="rx-plan-check">
              <input
                type="checkbox"
                checked={showDate}
                onChange={(e) => setShowDate(e.target.checked)}
              />
              {t("share.showDate")}
            </label>
          )}
          <p>{t("share.photoLocal")}</p>
          <Button disabled={!ready} className="rx-primary rx-wide" type="button" onClick={download}>
            <Download size={18} />
            {t("share.download")}
          </Button>
          {error && (
            <div role="alert">
              <p>{t("share.renderFail")}</p>
              <Button type="button" onClick={() => setRetry((v) => v + 1)}>
                <RotateCcw size={16} />
                {t("error.retry")}
              </Button>
            </div>
          )}
          <small>
            {CARD_SIZE[ratio].w} × {CARD_SIZE[ratio].h} · PNG ·{" "}
            {t(photo ? "share.photo" : "share.transparent")}
          </small>
        </Panel>
        <div
          className={"rx-card-preview rx-checker " + (theme === "light" ? "rx-checker-light" : "")}
        >
          <canvas ref={canvas} role="img" aria-label={card.subtitle || card.mainValue} />
        </div>
      </div>
    </div>
  );
}
