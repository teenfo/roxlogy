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
  tz?: string, // IANA 시간대 — 미지정 시 실행 환경 기본(서버=UTC)
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(tag, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

export function formatDateShort(
  iso: string | null | undefined,
  tag: string = "en-US",
  tz?: string,
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(tag, {
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
}

/** 짧은 날짜 + 2자리 연도 (차트 축 등 연도 구분이 필요한 곳). */
export function formatDateShortYear(
  iso: string | null | undefined,
  tag: string = "en-US",
  tz?: string,
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(tag, {
    year: "2-digit",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
}

/**
 * 프로그램 일차(day_index, 1-based)에 해당하는 실제 날짜를 짧은 형식으로.
 * startDate(YYYY-MM-DD)가 없으면 null. 날짜만 다루므로 UTC로 계산해 TZ 밀림 방지.
 */
export function programDayDate(
  startDate: string | null | undefined,
  dayIndex: number,
  tag: string = "en-US",
): string | null {
  if (!startDate) return null;
  const base = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + (dayIndex - 1));
  return base.toLocaleDateString(tag, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

/**
 * 날짜만 있는 값(YYYY-MM-DD: 대회일·목표일)의 로케일 표기.
 * 시각이 없으므로 UTC 로 고정해 시간대에 따라 하루 밀리는 것을 막는다.
 * (DB 의 date 컬럼을 그대로 화면에 뿌리면 ko/es 사용자에게 ISO 원문이 보인다)
 */
export function formatDateOnly(
  date: string | null | undefined,
  tag: string = "en-US",
): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(tag, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * 사용자 시간대 기준 "오늘" 날짜 (YYYY-MM-DD).
 * 서버는 UTC 로 도므로 new Date() 를 그대로 쓰면 KST 사용자는 자정~오전 9시
 * 사이에 전날 일차를 보게 된다. 크루 일정·회비가 Asia/Seoul 을 쓰므로
 * 시간대 쿠키가 없을 때의 폴백도 Asia/Seoul 로 맞춘다.
 */
export function todayISOIn(tz?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 사용자 시간대 기준 오늘 자정 Date (프로그램 일차 계산용) */
export function todayMidnightIn(tz?: string): Date {
  return new Date(`${todayISOIn(tz)}T00:00:00`);
}

/**
 * 시작일로부터 daysSince(0-based)일째의 프로그램 일차(1-based).
 * repeat 면 사이클(max day_index)로 순환한다. 시작 전이면 null.
 * 스케줄·대시보드·오늘의 WOD·캘린더가 모두 이 규칙을 공유한다.
 */
export function programDayNumber(
  daysSince: number,
  cycleLen: number,
  repeat: boolean,
): number | null {
  if (daysSince < 0) return null;
  if (!repeat) return daysSince + 1;
  if (cycleLen <= 0) return null;
  return (daysSince % cycleLen) + 1;
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
