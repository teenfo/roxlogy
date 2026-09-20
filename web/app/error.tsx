"use client";

import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { Go } from "@/components/rox/ui";

/**
 * 라우트 오류 경계 — 시안 ErrorScreen 그대로 (.rx-state-page, 스펙 §18).
 *
 * 화면에는 **사유와 다음 행동만** 둔다. 프로덕션 빌드는 오류 메시지를 지우고
 * digest 만 남기므로(민감한 정보가 새지 않게 하려는 Next 의 설계), 사용자에게는
 * 그 코드만 보여 주고 원문은 콘솔로 보낸다.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    // 프로덕션에서는 message 가 비어 있고 digest 만 있다 — 서버 로그와 짝을 맞춘다
    console.error("route error", error);
  }, [error]);

  return (
    <section className="rx-state-page">
      <div>
        <span className="rx-state-icon warning">
          <ShieldAlert />
        </span>
        <h1>{t("error.title")}</h1>
        <p>{t("error.desc")}</p>
        <div className="rx-actions">
          <Button className="rx-primary" onClick={reset}>
            {t("error.retry")}
          </Button>
          <Go href="/dashboard">{t("nav.dashboard")}</Go>
        </div>
        {error.digest && (
          <p className="rx-state-note">
            {t("error.digest")} {error.digest}
          </p>
        )}
      </div>
    </section>
  );
}
