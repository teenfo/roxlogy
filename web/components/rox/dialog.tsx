"use client";

/**
 * 시안의 RoxDialog — 우리 components/ui/dialog.tsx(포털·inert·포커스 계약) 위에
 * 시안 모양(.rx-custom-dialog / .rx-custom-sheet / 핸들 / 헤더)을 얹는 어댑터.
 * roxlogy-renewal/source/components/rox/dialog.tsx 그대로. 시안의 custom-dialog.tsx
 * 는 우리 Dialog 의 복사본이라 가져오지 않는다 (PORT_PLAN §1-a).
 *
 * kind:
 *   - "adaptive" (기본): 768px 미만 바텀시트, 그 이상 중앙 모달 (스펙 §20)
 *   - "sheet": 항상 바텀시트 모양(우리 Dialog 는 md 이상에서 center 로 되돌린다)
 *   - "modal": 항상 중앙
 */
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/components/i18n-provider";

export function RoxDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  kind = "adaptive",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  kind?: "modal" | "sheet" | "adaptive";
}) {
  const { t } = useI18n();
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const sheet = mobile && kind !== "modal";
  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      label={title}
      closeLabel={t("common.close")}
      variant={sheet ? "sheet" : "center"}
      panelClassName={"rx-custom-dialog " + (sheet ? "rx-custom-sheet" : "")}
    >
      <div className="rx-dialog-handle" />
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => onOpenChange(false)}
        >
          <X size={20} />
        </button>
      </header>
      {description && <p>{description}</p>}
      <div className="rx-dialog-body">{children}</div>
    </Dialog>
  );
}
