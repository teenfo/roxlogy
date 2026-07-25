"use client";

import { useRef } from "react";
import { disablePush } from "@/lib/push/client";

/**
 * 로그아웃 폼 — 제출 전에 이 브라우저의 푸시 구독을 해제한다(최대 1.5초).
 * 공유 브라우저에서 로그아웃한 뒤에도 이전 사용자 알림이 계속 오는 문제 방지.
 * 해제 실패해도 로그아웃은 진행(베스트 에포트).
 */
export function SignOutForm({
  className,
  buttonClassName,
  label,
}: {
  className?: string;
  buttonClassName: string;
  label: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  return (
    <form
      ref={formRef}
      action="/auth/signout"
      method="post"
      className={className}
      onSubmit={(e) => {
        if (submitting.current) return; // 두 번째 제출(실제 전송)은 통과
        e.preventDefault();
        submitting.current = true;
        Promise.race([
          disablePush().catch(() => {}),
          new Promise((r) => setTimeout(r, 1500)),
        ]).finally(() => formRef.current?.submit());
      }}
    >
      <button type="submit" className={buttonClassName}>
        {label}
      </button>
    </form>
  );
}
