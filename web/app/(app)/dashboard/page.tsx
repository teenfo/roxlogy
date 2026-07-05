import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMs, SOURCE_DEVICE_LABEL } from "@/lib/format";

const DIVISION_LABEL: Record<string, string> = {
  open: "오픈",
  pro: "프로",
  doubles: "더블",
  pro_doubles: "프로 더블",
  relay: "릴레이",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: recent }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase
      .from("sessions")
      .select("id, started_at, total_time_ms, source_device")
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(3),
  ]);

  return (
    <main>
      <h1 className="text-2xl font-bold">
        {profile?.display_name ?? user!.email}
      </h1>
      <p className="mt-1 text-sm text-muted">
        디비전:{" "}
        {profile?.division
          ? (DIVISION_LABEL[profile.division] ?? profile.division)
          : "미설정"}
      </p>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">최근 세션</h2>
          <Link href="/sessions" className="text-sm text-accent hover:underline">
            전체 보기
          </Link>
        </div>

        {!recent?.length ? (
          <p className="mt-4 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            아직 기록된 세션이 없습니다. 워치·폰 앱 연동 전에는 시드 데이터로
            확인할 수 있습니다.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {recent.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="flex items-center justify-between rounded-md bg-surface px-4 py-3 hover:bg-surface/70"
                >
                  <span className="text-sm">{formatDate(s.started_at)}</span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="text-muted">
                      {SOURCE_DEVICE_LABEL[s.source_device] ?? s.source_device}
                    </span>
                    <span className="font-mono font-semibold">
                      {formatMs(s.total_time_ms)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
