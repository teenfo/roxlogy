"use client";

import { useSyncExternalStore } from "react";
import { Watch as WatchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { roxNative } from "@/lib/native";
import { Go, PageHead, Panel } from "./ui";

/**
 * 시안 WatchScreen 그대로. 앱(WebView) 안이면 네이티브 워치 화면을 여는 버튼,
 * 브라우저면 앱 안내 + 다운로드 링크. 시안의 미리보기 전환 링크는 넣지 않는다.
 */
export function WatchScreen() {
  const { t } = useI18n();
  const native = useSyncExternalStore(
    () => () => {},
    () => roxNative() !== null,
    () => false,
  );
  return (
    <>
      <PageHead title={t("watch.title")} description={t("watch.hint")} />
      <Panel className="rx-watch-panel">
        <span className="rx-state-icon">
          <WatchIcon size={42} />
        </span>
        <h2>{t(native ? "watch.ready" : "watch.web")}</h2>
        <p>{t(native ? "watch.readyHint" : "watch.webHint")}</p>
        {native ? (
          <Button
            className="rx-primary"
            onClick={() => {
              const b = roxNative();
              b?.openWatch?.();
            }}
          >
            {t("watch.connect")}
          </Button>
        ) : (
          <Go href="/download">{t("watch.download")}</Go>
        )}
      </Panel>
    </>
  );
}
