"use client";

import { NavIcon } from "@/components/nav-icon";
import { inputCls } from "@/components/ui/app-ui";

/**
 * 검색·선택·보기 전환 — 디자인 스펙 1.3 §05·§06.
 *
 * 세 가지 모두 **접근 가능한 이름**을 필수로 받는다. 검색 아이콘만 있는 입력과
 * 라벨 없는 select 는 스크린 리더에서 "편집" · "콤보 상자"로만 읽힌다.
 */

/** 검색 입력 — 높이 40px, 최대 450px (스펙 §06) */
export function Find({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 접근 가능한 이름 */
  label: string;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full max-w-[450px]">
      <NavIcon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-3"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder ?? label}
        size={1}
        className={`${inputCls} h-10 pl-9`}
      />
    </div>
  );
}

/** 선택 필터 — 높이 40px */
export function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={`${inputCls} h-10 w-auto pr-8`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * 같은 화면 안의 보기 전환 — 높이 33px.
 *
 * 터치 영역은 44px 를 채운다(스펙 모바일 §02 는 33px 탭에 "터치 영역 44px 확대
 * 권장"을 달아 두었다). 보이는 높이는 그대로 두고 세로 패딩으로 늘린다.
 */
export function Segments({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex min-w-0 gap-1 overflow-x-auto rounded-[10px] border border-line bg-inset p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`flex h-[33px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors max-md:h-11 ${
              on
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {o.label}
            {o.count != null && (
              <span className={on ? "opacity-70" : "text-muted-3"}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
