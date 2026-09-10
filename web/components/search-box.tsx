"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";

/** 검색 입력 — 제출하면 ?q= 로 이동한다 (결과는 서버에서 렌더) */
export function SearchBox({ initial = "" }: { initial?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState(initial);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="flex gap-2"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("nav.searchPh")}
        aria-label={t("nav.search")}
        autoFocus
        className="h-10 w-full rounded-lg border border-line-mid bg-card px-3.5 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        className="h-10 shrink-0 rounded-lg bg-accent px-4 text-sm font-bold text-background hover:brightness-110"
      >
        {t("nav.search")}
      </button>
    </form>
  );
}
