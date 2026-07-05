"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  LOCALE_LABEL,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/lib/i18n/config";
import { useI18n } from "@/components/i18n-provider";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { locale } = useI18n();
  const [pending, setPending] = useState(false);

  async function change(next: Locale) {
    if (next === locale) return;
    setPending(true);
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    });
    router.refresh();
    setPending(false);
  }

  return (
    <select
      value={locale}
      disabled={pending}
      onChange={(e) => change(e.target.value as Locale)}
      aria-label="Language"
      className={
        compact
          ? "rounded-md border border-muted/30 bg-transparent px-2 py-1 text-xs text-muted outline-none focus:border-accent"
          : "rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
      }
    >
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l} value={l} className="bg-surface text-foreground">
          {LOCALE_LABEL[l]}
        </option>
      ))}
    </select>
  );
}
