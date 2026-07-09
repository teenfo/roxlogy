"use client";

import { useState } from "react";

/** (?) 아이콘 — 클릭하면 설명을 팝오버로 표시. 바깥 클릭 시 닫힘. */
export function InfoTip({ text, label = "info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted/50 text-[10px] font-bold text-muted hover:border-foreground hover:text-foreground"
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
          <span className="absolute left-0 top-6 z-20 block w-60 rounded-md border border-surface bg-background px-3 py-2 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg">
            {text}
          </span>
        </>
      )}
    </span>
  );
}
