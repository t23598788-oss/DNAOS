"use client";

// UIKit — IconRail
// แถบไอคอนซ้ายสุดแบบแอป LINE — เลือกได้ทีละ 1 (ไม่ใช่ multi-toggle แบบ Dock)
// ใช้สลับว่ากำลังดูฟังก์ชันไหนของ DNA OS อยู่ (เลขา/ลูกค้า LINE/งาน/คู่ค้า/เอกสาร/ธุรกิจการเงิน/บ่อวัสดุ)
// รายการไอคอนมาจาก props.items เท่านั้น — ไม่ hardcode ชื่อโมดูลธุรกิจในไฟล์นี้

import type { ElementType } from "react";
import Link from "next/link";

export interface IconRailItem {
  key: string;
  label: string;
  icon: ElementType;
  href?: string;
  badge?: number;
}

export default function IconRail({
  items,
  activeKey,
  onSelect,
}: {
  items: IconRailItem[];
  activeKey: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="w-[64px] flex-shrink-0 bg-white border-r border-stone-200 flex flex-col items-center gap-1 py-3">
      {items.map((item) => {
        const active = item.key === activeKey;
        const Icon = item.icon;
        const className =
          "relative w-11 h-11 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors " +
          (active
            ? "bg-emerald-50 text-emerald-600"
            : "text-stone-400 hover:bg-stone-100 hover:text-stone-700");
        const content = (
          <>
            <Icon className="w-[18px] h-[18px]" />
            <span className="text-[9px] leading-none">{item.label}</span>
            {!!item.badge && (
              <span className="absolute top-0.5 right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center text-[8px] font-bold bg-rose-600 text-white rounded-full">
                {item.badge > 9 ? "9+" : item.badge}
              </span>
            )}
          </>
        );
        return item.href ? (
          <Link key={item.key} href={item.href} title={item.label} className={className}>
            {content}
          </Link>
        ) : (
          <button key={item.key} title={item.label} onClick={() => onSelect?.(item.key)} className={className}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
