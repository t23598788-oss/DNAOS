"use client";

// UIKit — ActionBar
// แถบปุ่มสั่งงานด้านล่างกระทู้แชต (owner request 2026-07-11: ซ่อน Events/Documents/
// Transactions ไว้เบื้องหลังปุ่ม แทนที่จะให้ผู้ใช้เปิดหลายหน้า/หลายเมนู) — component
// นี้ "โง่" โดยตั้งใจ รับแค่รายการปุ่มผ่าน props ไม่ผูกกับ business logic ใดๆ ในไฟล์นี้
// ปุ่มที่เกินจะยุบเข้า overflow "เพิ่มเติม" อัตโนมัติถ้าส่ง overflowActions มา

import { useState } from "react";
import type { ElementType } from "react";
import { MoreHorizontal } from "lucide-react";

export interface ActionBarItem {
  key: string;
  label: string;
  icon: ElementType;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
}

export default function ActionBar({
  actions,
  overflowActions,
}: {
  actions: ActionBarItem[];
  overflowActions?: ActionBarItem[];
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-1.5 px-3 py-2 border-t border-stone-200 bg-white flex-shrink-0 overflow-x-auto">
      {actions.map((a) => (
        <button
          key={a.key}
          title={a.tooltip ?? a.label}
          onClick={a.onClick}
          disabled={a.disabled}
          className={
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 " +
            (a.disabled
              ? "text-stone-300 cursor-not-allowed"
              : "text-stone-600 hover:bg-stone-100 hover:text-stone-900")
          }
        >
          <a.icon className="w-4 h-4" />
          <span>{a.label}</span>
        </button>
      ))}

      {overflowActions && overflowActions.length > 0 && (
        <div className="relative flex-shrink-0">
          <button
            title="เพิ่มเติม"
            onClick={() => setOverflowOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
            <span>เพิ่มเติม</span>
          </button>
          {overflowOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOverflowOpen(false)} />
              <div className="absolute bottom-full right-0 mb-1 z-20 w-48 bg-white border border-stone-200 rounded-lg shadow-lg py-1">
                {overflowActions.map((a) => (
                  <button
                    key={a.key}
                    disabled={a.disabled}
                    onClick={() => { setOverflowOpen(false); a.onClick(); }}
                    className={
                      "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors " +
                      (a.disabled ? "text-stone-300 cursor-not-allowed" : "text-stone-600 hover:bg-stone-50")
                    }
                  >
                    <a.icon className="w-3.5 h-3.5" />
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
