"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 일정 참석 토글 — 멤버만 사용 가능 */
export function CrewRsvpButton({
  eventId,
  status,
  canRsvp,
}: {
  eventId: string;
  status: "going" | "maybe" | "declined" | null;
  canRsvp: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const going = status === "going";

  if (!canRsvp) return null;

  async function toggle() {
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    if (going) {
      await supabase
        .from("crew_event_rsvps")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", user.id);
    } else {
      await supabase
        .from("crew_event_rsvps")
        .upsert(
          { event_id: eventId, user_id: user.id, status: "going" },
          { onConflict: "event_id,user_id" },
        );
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
        going
          ? "border-muted/40 text-muted hover:border-foreground"
          : "border-accent text-accent hover:bg-accent/10"
      }`}
    >
      {going ? t("crew.rsvpCancel") : t("crew.rsvpGoing")}
    </button>
  );
}
