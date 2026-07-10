"use client";

// UIKit — ListColumn
// คอลัมน์รายการแบบแอป LINE (ช่องค้นหา + รายชื่อ + unread badge) — คอลัมน์กลางของ AppShell
// รับข้อมูลผ่าน props ทั้งหมด ไม่ hardcode ชื่อลูกค้า/บริษัทในไฟล์นี้

import { useState } from "react";
import { Search } from "lucide-react";
import EmptyState from "./EmptyState";

export interface ListColumnItem {
  id: string;
  title: string;
  subtitle?: string;
  timestamp?: string;
  avatarUrl?: string;
  badge?: number;
  highlighted?: boolean; // แถวที่ต้องการความสนใจเป็นพิเศษ (เช่น มีร่างข้อความรออนุมัติ)
}

export default function ListColumn({
  items,
  activeId,
  onSelect,
  searchPlaceholder = "ค้นหา...",
  emptyMessage = "ยังไม่มีรายการ",
}: {
  items: ListColumnItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? items.filter((i) =>
        (i.title + " " + (i.subtitle ?? "")).toLowerCase().includes(query.trim().toLowerCase())
      )
    : items;

  return (
    <div className="w-[300px] flex-shrink-0 bg-white border-r border-stone-200 flex flex-col h-full">
      <div className="p-2.5 border-b border-stone-100 flex-shrink-0">
        <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-xs text-stone-700 placeholder-stone-400 outline-none min-w-0"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState message={emptyMessage} />
        ) : (
          filtered.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-stone-50 transition-colors " +
                  (active ? "bg-emerald-50" : item.highlighted ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-stone-50")
                }
              >
                <div className="w-9 h-9 rounded-full bg-stone-200 flex-shrink-0 overflow-hidden flex items-center justify-center text-[11px] font-semibold text-stone-500">
                  {item.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    item.title.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-stone-800 truncate">{item.title}</p>
                    {item.timestamp && (
                      <span className="text-[10px] text-stone-400 flex-shrink-0">{item.timestamp}</span>
                    )}
                  </div>
                  {item.subtitle && (
                    <p className="text-[11px] text-stone-400 truncate mt-0.5">{item.subtitle}</p>
                  )}
                </div>
                {!!item.badge && (
                  <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold bg-rose-600 text-white rounded-full flex-shrink-0">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
