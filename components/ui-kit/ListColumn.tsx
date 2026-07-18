"use client";

// UIKit — ListColumn
// คอลัมน์รายการแบบแอป LINE (ช่องค้นหา + รายชื่อ + unread badge) — คอลัมน์กลางของ AppShell
// รับข้อมูลผ่าน props ทั้งหมด ไม่ hardcode ชื่อลูกค้า/บริษัทในไฟล์นี้
//
// TASK-002 Human Reality Chat UX (owner, 2026-07-17): added pin/unread (both
// client-only UI state — no DB field exists for either, per the owner's own
// "ไม่แตะ Database" scope) and a 3-state collapse (360px / 64px / hidden),
// remembered in localStorage. Sort-to-top-on-new-message is NOT done here —
// this component renders whatever order `items` arrives in; the caller
// (already sorting relationships by last_message_at) owns that decision, so
// this stays a pure presentation component per its own header comment.

import { useState, useEffect } from "react";
import { Search, Pin, Menu, ChevronLeft } from "lucide-react";
import EmptyState from "./EmptyState";

export interface ListColumnItem {
  id: string;
  title: string;
  subtitle?: string;
  timestamp?: string;
  avatarUrl?: string;
  badge?: number;
  highlighted?: boolean; // แถวที่ต้องการความสนใจเป็นพิเศษ (เช่น มีร่างข้อความรออนุมัติ)
  pinned?: boolean;
  unread?: boolean;
}

export type ListColumnWidth = "full" | "compact" | "hidden";
const WIDTH_PX: Record<ListColumnWidth, number> = { full: 300, compact: 64, hidden: 0 };
const STORAGE_KEY = "dnaos.listColumn.width";

export default function ListColumn({
  items,
  activeId,
  onSelect,
  searchPlaceholder = "ค้นหา...",
  emptyMessage = "ยังไม่มีรายการ",
  collapsible = false,
}: {
  items: ListColumnItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  collapsible?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState<ListColumnWidth>("full");

  // Remember workspace layout (owner request, TASK-002 item 7) — read once
  // on mount; localStorage doesn't exist server-side, safe here since this
  // whole tree is already a client component ("use client" above).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ListColumnWidth | null;
    if (saved === "full" || saved === "compact" || saved === "hidden") setWidth(saved);
  }, []);

  const cycleWidth = () => {
    const next: ListColumnWidth = width === "full" ? "compact" : width === "compact" ? "hidden" : "full";
    setWidth(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  const filtered = query.trim()
    ? items.filter((i) =>
        (i.title + " " + (i.subtitle ?? "")).toLowerCase().includes(query.trim().toLowerCase())
      )
    : items;

  if (collapsible && width === "hidden") {
    return (
      <button
        onClick={cycleWidth}
        title="แสดงรายการ"
        className="w-6 flex-shrink-0 bg-stone-50 border-r border-stone-200 flex items-center justify-center hover:bg-stone-100 transition"
      >
        <Menu size={14} className="text-stone-400" />
      </button>
    );
  }

  const isCompact = collapsible && width === "compact";

  return (
    <div
      className="flex-shrink-0 bg-white border-r border-stone-200 flex flex-col h-full transition-[width] duration-150"
      style={{ width: collapsible ? WIDTH_PX[width] : 300 }}
    >
      <div className="p-2.5 border-b border-stone-100 flex-shrink-0 flex items-center gap-1.5">
        {!isCompact && (
          <div className="flex-1 flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 min-w-0">
            <Search className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-xs text-stone-700 placeholder-stone-400 outline-none min-w-0"
            />
          </div>
        )}
        {collapsible && (
          <button
            onClick={cycleWidth}
            title="ย่อ/ขยายรายการ"
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition"
          >
            {isCompact ? <Menu size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          !isCompact && <EmptyState message={emptyMessage} />
        ) : (
          filtered.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                title={isCompact ? item.title : undefined}
                className={
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-stone-50 transition-colors " +
                  (isCompact ? "justify-center px-1.5" : "") + " " +
                  (active ? "bg-emerald-50" : item.highlighted ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-stone-50")
                }
              >
                <div className="relative w-9 h-9 rounded-full bg-stone-200 flex-shrink-0 overflow-hidden flex items-center justify-center text-[11px] font-semibold text-stone-500">
                  {item.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    item.title.slice(0, 1).toUpperCase()
                  )}
                  {isCompact && !!item.badge && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center text-[9px] font-bold bg-rose-600 text-white rounded-full">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </div>
                {!isCompact && (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        {item.pinned && <Pin size={10} className="text-stone-400 flex-shrink-0" fill="currentColor" />}
                        <p className={"text-xs truncate " + (item.unread ? "font-bold text-stone-900" : "font-medium text-stone-800")}>{item.title}</p>
                        {item.timestamp && (
                          <span className={"text-[10px] flex-shrink-0 ml-auto " + (item.unread ? "text-emerald-600 font-semibold" : "text-stone-400")}>{item.timestamp}</span>
                        )}
                      </div>
                      {item.subtitle && (
                        <p className={"text-[11px] truncate mt-0.5 " + (item.unread ? "text-stone-600 font-medium" : "text-stone-400")}>{item.subtitle}</p>
                      )}
                    </div>
                    {!!item.badge && (
                      <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold bg-rose-600 text-white rounded-full flex-shrink-0">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
