/**
 * 브라우저에서 CSV 파일을 만들어 내려받는다.
 *
 * 서버 라우트를 두지 않는다 — 내려받는 데이터는 이미 화면에 온 것이라 권한
 * 검사를 한 번 더 쓸 이유가 없다. 엑셀이 UTF-8 로 읽도록 BOM 을 붙인다(없으면
 * 한글이 깨진다). 회원 명단·회계 내보내기가 같이 쓴다.
 */
export function downloadCsv(filename: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
