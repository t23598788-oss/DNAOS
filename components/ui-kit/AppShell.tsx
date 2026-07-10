"use client";

// UIKit — AppShell
// โครง 3 คอลัมน์ถาวรแบบแอป LINE: IconRail (ซ้ายสุด) + ListColumn (กลาง) + พื้นที่เนื้อหาหลัก (children)
// ต่างจาก WorkspaceCanvas/Dock/WindowLayer ตรงที่นี่ไม่ใช่หน้าต่างลอยเปิด-ปิด — ทั้ง 3 คอลัมน์อยู่ติดกันตลอดเวลา
// (owner request 2026-07-11: "ดัดแปลงให้เหมือนรูปแบบแอปพลิเคชัน LINE เลย")

import type { ReactNode } from "react";
import IconRail, { type IconRailItem } from "./IconRail";
import ListColumn, { type ListColumnItem } from "./ListColumn";

export default function AppShell({
  railItems,
  activeRailKey,
  onSelectRail,
  listItems,
  activeListId,
  onSelectList,
  listSearchPlaceholder,
  listEmptyMessage,
  children,
}: {
  railItems: IconRailItem[];
  activeRailKey: string;
  onSelectRail?: (key: string) => void;
  listItems: ListColumnItem[];
  activeListId?: string | null;
  onSelectList: (id: string) => void;
  listSearchPlaceholder?: string;
  listEmptyMessage?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full h-screen bg-white overflow-hidden">
      <IconRail items={railItems} activeKey={activeRailKey} onSelect={onSelectRail} />
      <ListColumn
        items={listItems}
        activeId={activeListId}
        onSelect={onSelectList}
        searchPlaceholder={listSearchPlaceholder}
        emptyMessage={listEmptyMessage}
      />
      <div className="flex-1 min-w-0 h-full">{children}</div>
    </div>
  );
}
