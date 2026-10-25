"use client";

// UIKit — AppShell
// โครง 3 คอลัมน์ถาวรแบบแอป LINE: IconRail (ซ้ายสุด) + ListColumn (กลาง) + พื้นที่เนื้อหาหลัก (children)
// ต่างจาก WorkspaceCanvas/Dock/WindowLayer ตรงที่นี่ไม่ใช่หน้าต่างลอยเปิด-ปิด — ทั้ง 3 คอลัมน์อยู่ติดกันตลอดเวลา
// (owner request 2026-07-11: "ดัดแปลงให้เหมือนรูปแบบแอปพลิเคชัน LINE เลย")
//
// ONE NAVIGATION (owner 2026-10-18): เมื่อหน้านี้ถูกเปิดเป็นแท็บใน Workspace ที่มี
// Sidebar หลักชุดเดียวอยู่แล้ว การส่ง railItems มาอีกชุดจะทำให้ผู้ใช้เห็นแถบไอคอนซ้อน 2 ชั้น
// ⇒ railItems เป็น optional: ไม่ส่ง = ไม่วาด IconRail แต่ยังคง ListColumn + เนื้อหาหลักเดิม
// (ไม่ลบเครื่องมือ/route ใด ๆ — ผู้เรียกที่ยังต้องการ rail เดิมส่งมาภายหลังได้เหมือนเดิม)

import type { ReactNode } from "react";
import IconRail, { type IconRailItem } from "./navigation/IconRail";
import ListColumn, { type ListColumnItem } from "./navigation/ListColumn";

export default function AppShell({
  railItems,
  activeRailKey,
  onSelectRail,
  listItems,
  activeListId,
  onSelectList,
  listSearchPlaceholder,
  listEmptyMessage,
  listCollapsible,
  children,
}: {
  railItems?: IconRailItem[];
  activeRailKey?: string;
  onSelectRail?: (key: string) => void;
  listItems: ListColumnItem[];
  activeListId?: string | null;
  onSelectList: (id: string) => void;
  listSearchPlaceholder?: string;
  listEmptyMessage?: string;
  listCollapsible?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full h-screen bg-white overflow-hidden">
      {railItems && railItems.length > 0 && (
        <IconRail items={railItems} activeKey={activeRailKey ?? ""} onSelect={onSelectRail} />
      )}
      <ListColumn
        items={listItems}
        activeId={activeListId}
        onSelect={onSelectList}
        searchPlaceholder={listSearchPlaceholder}
        emptyMessage={listEmptyMessage}
        collapsible={listCollapsible}
      />
      <div className="flex-1 min-w-0 h-full">{children}</div>
    </div>
  );
}
