/** 원화 표기 — 시안 ui.tsx 의 won(). 크루 회계·회비 화면이 같은 모양을 쓴다. */
export const won = (n: number) => `${Math.abs(n).toLocaleString("ko-KR")}원`;

/** 시안 ui.tsx 의 downloadCSV — 브라우저에서 CSV 한 장을 만들어 내려받는다.
 *  엑셀이 UTF-8 로 읽게 BOM 을 붙인다(없으면 한글이 깨진다). 클라이언트에서만 부른다. */
export function downloadCSV(
  name: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const csv =
    "﻿" +
    [headers, ...rows]
      .map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(","))
      .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
