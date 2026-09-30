/** 원화 표기 — 크루 회계·회비 화면 공통. */
export const won = (n: number) => `${Math.abs(n).toLocaleString("ko-KR")}원`;

/** Compatibility alias for renewal components. */
export { downloadCsv as downloadCSV } from "@/lib/csv";
