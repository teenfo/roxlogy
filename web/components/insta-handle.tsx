"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";

/**
 * 인스타 핸들 — 터치하면 `@handle` 을 클립보드에 복사한다.
 *
 * 링크로 두면 앱(WebView)에서 인스타로 튕겨 나가 돌아오기 번거롭고, 실제로
 * 하는 일은 사진 태그·DM 에 붙여 넣는 것이라 복사가 맞다. 복사되면 2초 동안
 * "복사됨"으로 바뀐다. 클립보드 API 가 막힌 환경(http·권한 거부)에서는
 * prompt 로 보여 줘서 손으로 복사할 수 있게 한다.
 */
export function InstaHandle({ handle, className = "" }: { handle: string; className?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const text = `@${handle.replace(/^@/, "")}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      window.prompt(t("crew.shareCopyManual"), text);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={t("crew.instaCopyOne")}
      aria-label={`${text} · ${t("crew.instaCopyOne")}`}
      className={`rx-insta ${className}`}
    >
      {done ? t("crew.shareCopied") : text}
    </button>
  );
}

