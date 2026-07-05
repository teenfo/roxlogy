/** 밀리초 → "1:23:45" 또는 "4:32" (시가 0이면 생략) */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const SOURCE_DEVICE_LABEL: Record<string, string> = {
  watch: "워치",
  phone: "폰",
  web: "웹",
};

export const KIND_LABEL: Record<string, string> = {
  run: "런",
  station: "스테이션",
  roxzone: "록스존",
};
