"use client";

import { useEffect, useId, useState } from "react";

/** (?) 아이콘 — 클릭하면 설명을 팝오버로 표시. 바깥 클릭·Escape 로 닫힘.
 *  아이콘은 16px 이지만 실제 터치 영역은 40px(::after 확장) — UI 감사 2026-09-12 P1. */
export function InfoTip({ text, label = "info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="relative ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted/50 text-[10px] font-bold text-muted after:absolute after:-inset-3 after:content-[''] hover:border-foreground hover:text-foreground"
      >
        ?
      </button>
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <span
            id={id}
            role="tooltip"
            className="absolute right-0 top-6 z-20 block w-60 max-w-[calc(100vw-3rem)] rounded-md border border-surface bg-background px-3 py-2 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg"
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
