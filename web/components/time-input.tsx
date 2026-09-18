"use client";

import { useState } from "react";
import { formatTimeInput, parseTimeToMs } from "@/lib/format";

/** "mm:ss" 텍스트 입력 → ms 콜백. 빈 값은 null */
export function TimeInput({
  value,
  onChange,
  placeholder = "mm:ss",
  className = "",
}: {
  value: string;
  onChange: (text: string, ms: number | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [touched, setTouched] = useState(false);
  const ms = parseTimeToMs(value);
  const invalid = touched && value.trim() !== "" && ms == null;

  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        // 모바일 숫자 키패드에는 ':' 가 없다 — 친 숫자를 mm:ss 로 끼워 넣는다
        const v = formatTimeInput(e.target.value);
        onChange(v, parseTimeToMs(v));
      }}
      onBlur={() => setTouched(true)}
      className={`w-20 rounded-md border bg-background px-2 py-1.5 text-right font-mono text-sm outline-none focus:border-accent ${
        invalid ? "border-danger" : "border-muted/30"
      } ${className}`}
    />
  );
}
