"use client";

import { useState, type ReactNode } from "react";
import { Segments } from "@/components/rox/ui";

/**
 * 설정 탭 — 시안 account.tsx Settings() 의 Segments(프로필·계정·연동·알림).
 * 네 탭의 본문은 서버가 다 그려 넘기고(폼·연동 카드가 각자 클라이언트 상태를 가진다)
 * 여기서는 보이는 것만 고른다. 탭을 바꿔도 입력 중이던 값은 남는다(언마운트하지 않는다).
 */
export function SettingsTabs({ tabs, panels, label }: { tabs: [string, string][]; panels: Record<string, ReactNode>; label: string }) {
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <>
      <Segments value={tab} onChange={setTab} options={tabs} label={label} />
      {tabs.map(([key]) => (
        <div key={key} hidden={key !== tab}>
          {panels[key]}
        </div>
      ))}
    </>
  );
}
