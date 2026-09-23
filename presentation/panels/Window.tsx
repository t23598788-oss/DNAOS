"use client";

// UIKit — Window
// Component เดียวที่ทุกชิ้นใน UIKit ใช้เป็น "กรอบ" ร่วมกัน (title bar + close)
// ไม่มี business data ในไฟล์นี้ — รับทุกอย่างผ่าน props เท่านั้น (ตาม Constitution: ห้าม hardcode/mock ข้อมูลธุรกิจ)

import { X } from "lucide-react";
import type { ReactNode } from "react";

export interface WindowProps {
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
  className?: string;
  // "window" = floating card with border/shadow/close button (original
  // Dock/WorkspaceCanvas behavior). "panel" = fills its parent, no
  // border/shadow/close button — for content that lives permanently in a
  // fixed layout slot (e.g. the main pane of a LINE-style AppShell) rather
  // than an open/closable floating window.
  variant?: "window" | "panel";
}

export default function Window({
  title,
  icon,
  subtitle,
  onClose,
  children,
  width = 380,
  className = "",
  variant = "window",
}: WindowProps) {
  const isPanel = variant === "panel";
  return (
    <div
      style={isPanel ? undefined : { width }}
      className={
        "flex flex-col bg-white overflow-hidden " +
        (isPanel ? "w-full h-full " : "border border-stone-200 rounded-xl shadow-lg animate-[fadeIn_0.2s_ease-out] ") +
        className
      }
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-stone-100 flex-shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            {icon}
            <span className="truncate">{title}</span>
          </div>
          {subtitle && <p className="text-[11px] text-stone-400 truncate mt-0.5">{subtitle}</p>}
        </div>
        {!isPanel && (
          <button
            onClick={onClose}
            aria-label={"ปิด " + title}
            className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
