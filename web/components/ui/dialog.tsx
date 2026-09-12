"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * 접근성 모달/바텀시트 공통 컴포넌트 (UI 감사 2026-09-12 P0).
 *
 * 보장하는 것:
 * - role="dialog" + aria-modal + 접근 가능한 이름(label)
 * - 열리면 첫 컨트롤(없으면 패널)로 포커스, 닫히면 열었던 요소로 복귀
 * - Tab/Shift+Tab 포커스 트랩, Escape 닫기, 배경 클릭 닫기
 * - 배경 스크롤 잠금 + 배경 트리를 inert 로 만들어 보조기술·탭 이동에서 제외
 * - document.body 포털 — 부모의 overflow/transform 에 갇히지 않고 inert 대상과 분리
 *
 * variant:
 * - "scroll": 긴 폼. 공간이 남으면 세로 중앙, 화면보다 길면 위에 붙어 스크롤(my-auto)
 * - "center": 짧은 확인창. 항상 중앙, 패널 안에서 스크롤
 * - "sheet": 모바일 바텀시트(md 미만 전용)
 */
export function Dialog({
  open,
  onClose,
  label,
  children,
  variant = "scroll",
  panelClassName = "",
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** 대화상자의 접근 가능한 이름 — 제목 텍스트를 그대로 넘긴다 */
  label: string;
  children: ReactNode;
  variant?: "scroll" | "center" | "sheet";
  /** 패널(role=dialog 요소)에 붙는 클래스 — 폭·배경·패딩은 호출부가 정한다 */
  panelClassName?: string;
  /** 배경 버튼의 접근 가능한 이름(“닫기”). 시트에서 특히 중요 */
  closeLabel: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // 열림/닫힘 부수 효과 — 포커스 저장·이동·복귀, 스크롤 잠금, 배경 inert
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    // 첫 컨트롤이 닫기(배경) 버튼이면 건너뛴다 — 열자마자 “닫기”에 서 있으면 당황스럽다
    (first && !first.hasAttribute("data-dialog-backdrop") ? first : panel).focus({
      preventScroll: true,
    });

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const host = panel.parentElement; // 포털 루트
    const made: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === host || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      made.push(el);
    }
    return () => {
      document.body.style.overflow = overflow;
      for (const el of made) el.removeAttribute("inert");
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open || !mounted) return null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => !el.hasAttribute("data-dialog-backdrop") && el.offsetParent !== null);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const overlay =
    variant === "sheet"
      ? "fixed inset-0 z-50 md:hidden"
      : variant === "center"
        ? "fixed inset-0 z-50 flex items-center justify-center p-4"
        : "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-10";
  // position 유틸은 변형마다 다르다. 공통으로 relative 를 덧붙이면 Tailwind 출력 순서상
  // .relative 가 .absolute 를 이겨서 바텀시트가 화면 위로 올라간다(2026-09-12 실제 버그).
  const panel =
    variant === "sheet"
      ? "absolute inset-x-0 bottom-0 outline-none"
      : variant === "center"
        ? "relative max-h-[calc(100dvh-2rem)] w-full overflow-y-auto outline-none"
        : "relative my-auto w-full text-left outline-none";

  return createPortal(
    <div className={overlay} onKeyDown={onKeyDown}>
      {/* 배경 — 버튼이라 스크린리더·키보드로도 닫을 수 있다 */}
      <button
        type="button"
        data-dialog-backdrop
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`${panel} ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
