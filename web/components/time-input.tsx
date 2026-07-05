"use client";

import { useState } from "react";
import { parseTimeToMs } from "@/lib/format";

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
      onChange={(e) => onChange(e.target.value, parseTimeToMs(e.target.value))}
      onBlur={() => setTouched(true)}
      className={`w-20 rounded-md border bg-background px-2 py-1.5 text-right font-mono text-sm outline-none focus:border-accent ${
        invalid ? "border-red-400" : "border-muted/30"
      } ${className}`}
    />
  );
}
