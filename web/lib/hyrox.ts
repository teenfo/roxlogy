/**
 * 레이스 구조 상수 — 시드 01(supabase/seed/01_exercises_core.sql)의
 * 고정 UUID와 반드시 일치해야 한다.
 */

export const RUN_EXERCISE_ID = "e0000000-0000-0000-0000-000000000009";

export type StationDef = {
  exerciseId: string;
  key: string;
  nameKo: string;
  nameEn: string;
  machineType: "ski" | "row" | null;
  /** 목표 스플릿 역산용 상대 난이도 가중치 (공개 캘큘레이터들의 통상 분포 참고) */
  weight: number;
};

export const STATIONS: StationDef[] = [
  { exerciseId: "e0000000-0000-0000-0000-000000000001", key: "ski",      nameKo: "스키에르그 1000m",    nameEn: "SkiErg",            machineType: "ski", weight: 10 },
  { exerciseId: "e0000000-0000-0000-0000-000000000002", key: "sledpush", nameKo: "슬레드 푸시 50m",     nameEn: "Sled Push",         machineType: null,  weight: 12 },
  { exerciseId: "e0000000-0000-0000-0000-000000000003", key: "sledpull", nameKo: "슬레드 풀 50m",       nameEn: "Sled Pull",         machineType: null,  weight: 13 },
  { exerciseId: "e0000000-0000-0000-0000-000000000004", key: "burpee",   nameKo: "버피 브로드점프 80m", nameEn: "Burpee Broad Jump", machineType: null,  weight: 12 },
  { exerciseId: "e0000000-0000-0000-0000-000000000005", key: "row",      nameKo: "로잉 1000m",          nameEn: "Rowing",            machineType: "row", weight: 10 },
  { exerciseId: "e0000000-0000-0000-0000-000000000006", key: "farmers",  nameKo: "파머스 캐리 200m",    nameEn: "Farmers Carry",     machineType: null,  weight: 6 },
  { exerciseId: "e0000000-0000-0000-0000-000000000007", key: "lunges",   nameKo: "샌드백 런지 100m",    nameEn: "Sandbag Lunges",    machineType: null,  weight: 11 },
  { exerciseId: "e0000000-0000-0000-0000-000000000008", key: "wallballs", nameKo: "월볼 100회",         nameEn: "Wall Balls",        machineType: null,  weight: 13 },
];

/**
 * 차트 시리즈 색 — dataviz 검증 통과 조합 (다크 서피스 #1E1E1E 기준).
 * 스테이션은 브랜드 옐로(#FFD500)의 차트 톤 스텝. 록스존은 잔여
 * 카테고리라 뉴트럴 그레이 + 직접 라벨/갭으로 식별한다.
 */
/** 세션 차트 3색 (2026-09 디자인 핸드오프).
 *  런·스테이션·록스존을 화면마다 다른 색으로 그리면 스택바·랩 추이·스플릿을
 *  나란히 볼 때 같은 종류를 눈으로 잇지 못한다. globals.css 토큰과 맞춘다:
 *  런 = --info, 스테이션 = --accent-dim, 록스존 = 중립 회색. */
export const CHART_COLORS = {
  run: "#7dd3fc",
  station: "#e0c53a",
  roxzone: "#666666",
} as const;
