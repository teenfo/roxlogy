import Image from "next/image";
import Link from "next/link";
import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { STATIONS } from "@/lib/hyrox";
import { formatDateShort } from "@/lib/format";
import { PredictForm, type PredictSession } from "@/components/predict-form";
import { LocaleSwitcher } from "@/components/locale-switcher";

const EX_TO_KEY = new Map(STATIONS.map((s) => [s.exerciseId, s.key]));

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.predict"), description: t("predict.desc") };
}

export default async function PredictPage() {
  const { t, tag } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 로그인 시: 최근 레이스 시뮬 세션을 목표 계산용으로 불러온다.
  let sessions: PredictSession[] = [];
  if (user) {
    const { data: rows } = await supabase
      .from("sessions")
      .select(
        "id, started_at, total_time_ms, session_segments ( kind, exercise_id, split_time_ms )",
      )
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(30);
    sessions = (rows ?? [])
      .map((s) => {
        const segs = (s.session_segments ?? []) as {
          kind: string;
          exercise_id: string | null;
          split_time_ms: number | null;
        }[];
        const stations: Record<string, number> = {};
        let runTotalMs = 0;
        let roxTotalMs = 0;
        for (const seg of segs) {
          if (seg.split_time_ms == null) continue;
          if (seg.kind === "station" && seg.exercise_id) {
            const key = EX_TO_KEY.get(seg.exercise_id);
            if (key) stations[key] = seg.split_time_ms;
          } else if (seg.kind === "run") runTotalMs += seg.split_time_ms;
          else if (seg.kind === "roxzone") roxTotalMs += seg.split_time_ms;
        }
        return {
          id: s.id,
          label: formatDateShort(s.started_at, tag),
          total: s.total_time_ms ?? 0,
          stations,
          runTotalMs,
          roxTotalMs,
        };
      })
      .filter((s) => Object.keys(s.stations).length > 0);
  }

  return (
    <>
      <header className="border-b border-surface">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-black tracking-widest">ROXLOGY</span>
          </Link>
          <div className="flex items-center gap-4">
            <LocaleSwitcher compact />
            <Link
              href="/login"
              className="text-sm text-muted hover:text-foreground"
            >
              {t("common.login")}
            </Link>
          </div>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <PredictForm isLoggedIn={!!user} sessions={sessions} />
      </div>
    </>
  );
}
