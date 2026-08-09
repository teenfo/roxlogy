"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 크루 가입 — join_crew RPC 는 open 정책이면 즉시 active, 아니면 pending */
export function CrewJoinButton({
  slug,
  status,
  loggedIn,
}: {
  slug: string;
  status: "pending" | "active" | "blocked" | null;
  loggedIn: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!loggedIn)
    return (
      <a
        href={`/login?next=/crews/${slug}`}
        className="rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10"
      >
        {t("crew.loginToJoin")}
      </a>
    );

  if (status === "active")
    return (
      <span className="rounded-md border border-muted/40 px-4 py-2 text-sm font-semibold text-muted">
        {t("crew.joined")}
      </span>
    );

  if (status === "pending")
    return (
      <span className="rounded-md border border-muted/40 px-4 py-2 text-sm text-muted">
        {t("crew.pending")}
      </span>
    );

  async function join() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("join_crew", { p_slug: slug });
    setBusy(false);
    if (!error) router.refresh();
  }

  return (
    <button
      type="button"
      onClick={join}
      disabled={busy}
      className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-50"
    >
      {busy ? t("crew.joining") : t("crew.join")}
    </button>
  );
}
