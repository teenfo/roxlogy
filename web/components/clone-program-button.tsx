"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export function CloneProgramButton({
  programId,
  title,
}: {
  programId: string;
  title: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);

  async function clone() {
    setPending(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("clone_program", {
      p_source: programId,
      p_title: `${title} (${t("programs.copySuffix")})`,
    });
    setPending(false);
    if (!error && data) {
      router.push(`/programs/${data}`);
      router.refresh();
    }
  }

  return (
    <button
      onClick={clone}
      disabled={pending}
      className="rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
    >
      {pending ? t("common.saving") : t("programs.clone")}
    </button>
  );
}
