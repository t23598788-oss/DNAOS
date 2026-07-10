"use client";

// UIKit — Drawer
// แผงเลื่อนเข้า-ออกจากขอบจอ (ไม่ใช่ modal กลางจอ) — ใช้ห่อ component อื่นเมื่ออยากได้พื้นที่แถบข้าง
// ปิดแล้วพื้นที่ Workspace คืนเต็มจอทันที ไม่มี state ค้าง

import type { ReactNode } from "react";
import Window from "./Window";

export default function Drawer({
  open,
  onClose,
  title,
  icon,
  side = "right",
  width = 380,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  side?: "left" | "right";
  width?: number;
  children: ReactNode;
}) {
  if (!open) return null;

  const edgeClass = side === "left" ? "left-0 rounded-l-none" : "right-0 rounded-r-none";

  return (
    <div className={"absolute top-0 h-full z-20 " + edgeClass} style={{ width }}>
      <Window title={title} icon={icon} onClose={onClose} width="100%" className="h-full rounded-none">
        {children}
      </Window>
    </div>
  );
}
