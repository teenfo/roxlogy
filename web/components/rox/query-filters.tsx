"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Choice, Find, Segments } from "./ui";

/**
 * 시안의 Find·Choice·Segments 를 **쿼리스트링 필터**로 쓰는 어댑터.
 * 시안은 클라이언트 상태로 거르지만 우리 목록은 서버가 쿼리스트링으로 거른다
 * (페이지네이션·count 와 같은 WHERE). 값을 바꾸면 그 파라미터만 갈아 끼우고
 * page 는 지운다. 기본값("all" 등)이면 파라미터를 뺀다.
 */
function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (param: string, value: string, defaultValue?: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value === "" || value === defaultValue) next.delete(param);
    else next.set(param, value);
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
}

export function QuerySegments({
  param,
  value,
  options,
  label,
  defaultValue = "all",
}: {
  param: string;
  value: string;
  options: (string | [string, string])[];
  label: string;
  defaultValue?: string;
}) {
  const set = useSetParam();
  return (
    <Segments
      value={value}
      onChange={(v) => set(param, v, defaultValue)}
      options={options}
      label={label}
    />
  );
}

export function QueryChoice({
  param,
  value,
  options,
  label,
  defaultValue = "all",
}: {
  param: string;
  value: string;
  options: (string | [string, string])[];
  label: string;
  defaultValue?: string;
}) {
  const set = useSetParam();
  return (
    <Choice
      value={value}
      onChange={(v) => set(param, v, defaultValue)}
      options={options}
      label={label}
    />
  );
}

/** 검색어 — 입력마다 이동하면 요청이 쏟아지므로 Enter/포커스 아웃에 반영한다 */
export function QueryFind({
  param,
  value,
  placeholder,
}: {
  param: string;
  value: string;
  placeholder: string;
}) {
  const set = useSetParam();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.querySelector("input");
        set(param, input?.value.trim() ?? "");
      }}
      onBlur={(e) => {
        const input = e.currentTarget.querySelector("input");
        const v = input?.value.trim() ?? "";
        if (v !== value) set(param, v);
      }}
    >
      <FindUncontrolled defaultValue={value} placeholder={placeholder} />
    </form>
  );
}

function FindUncontrolled({
  defaultValue,
  placeholder,
}: {
  defaultValue: string;
  placeholder: string;
}) {
  // Find 는 제어 컴포넌트라 로컬 상태로 감싼다
  return <FindState initial={defaultValue} placeholder={placeholder} />;
}

import { useState } from "react";
function FindState({ initial, placeholder }: { initial: string; placeholder: string }) {
  const [v, setV] = useState(initial);
  return <Find value={v} onChange={setV} placeholder={placeholder} />;
}
