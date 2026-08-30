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
  const [err, setErr] = useState<string | null>(null);

  async function clone() {
    setPending(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("clone_program", {
      p_source: programId,
      p_title: `${title} (${t("programs.copySuffix")})`,
    });
    setPending(false);
    if (error || !data) {
      // 아무 표시 없이 버튼만 원복되면 성공인지 실패인지 알 수 없다
      return setErr(error?.message ?? t("programs.cloneFailed"));
    }
    router.push(`/programs/${data}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={clone}
        disabled={pending}
        className="rounded-md border border-accent/50 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
      >
        {pending ? t("common.saving") : t("programs.clone")}
      </button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
