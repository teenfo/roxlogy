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

/** locale tag 예: "en-US" | "ko-KR" | "es-ES" (lib/i18n/config.ts LOCALE_TAG) */
export function formatDate(
  iso: string | null | undefined,
  tag: string = "en-US",
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(tag, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateShort(
  iso: string | null | undefined,
  tag: string = "en-US",
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(tag, {
    month: "short",
    day: "numeric",
  });
}

/** "mm:ss" / "h:mm:ss" → ms. 잘못된 입력이면 null */
export function parseTimeToMs(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length > 1 && parts.slice(1).some((p) => p > 59)) return null;
  const sec = parts.reduce((acc, p) => acc * 60 + p, 0);
  return sec * 1000;
}
