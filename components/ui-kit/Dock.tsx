"use client";

// UIKit — Dock
// แถบไอคอนเล็ก ๆ ริมจอ (ซ้าย/ขวา/ล่าง) — ไม่ใช่ sidebar ที่เปิดค้างตลอด
// คลิกไอคอน = เปิด/ปิด component ที่ผูกไว้ ผ่าน useWorkspace().open / closeByKey
// รายการไอคอนมาจาก props.items เท่านั้น — ไม่ hardcode ชื่อโมดูลธุรกิจในไฟล์นี้

import type { ElementType } from "react";
import { useWorkspace, type ComponentKey } from "./WorkspaceCanvas";

export interface DockItem {
  key: ComponentKey;
  label: string;
  icon: ElementType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props?: Record<string, any>;
  badge?: string | number;
}

export default function Dock({
  items,
  side = "right",
}: {
  items: DockItem[];
  side?: "left" | "right" | "bottom";
}) {
  const { isOpen, open, closeByKey } = useWorkspace();

  const positionClass =
    side === "left"
      ? "left-0 top-0 h-full flex-col border-r"
      : side === "bottom"
      ? "bottom-0 left-0 w-full flex-row border-t"
      : "right-0 top-0 h-full flex-col border-l";

  return (
    <div
      className={
        "absolute z-30 bg-white border-stone-200 flex items-center gap-1.5 p-2 " + positionClass
      }
    >
      {items.map((item) => {
        const active = isOpen(item.key);
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            title={item.label}
            onClick={() => (active ? closeByKey(item.key) : open(item.key, item.props))}
            className={
              "relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors " +
              (active
                ? "bg-emerald-50 border border-emerald-200 text-emerald-600"
                : "text-stone-400 border border-transparent hover:bg-stone-100 hover:text-stone-700")
            }
          >
            <Icon className="w-4 h-4" />
            {item.badge !== undefined && (
              <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-rose-600 text-white rounded-full px-1 leading-tight">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
