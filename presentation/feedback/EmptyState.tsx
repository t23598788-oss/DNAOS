// UIKit — EmptyState
// สถานะ "ยังไม่มีข้อมูล" ที่ทุก component ในชุดนี้ใช้ร่วมกัน แทนการแสดง mock/fake data
// เมื่อ props ที่ส่งเข้ามาว่างเปล่า — เหมือน pattern เดิมใน PortalShell.tsx ("ยังไม่มีเนื้อหาจริง — รอรายละเอียดจากเจ้าของระบบ")

import type { ElementType } from "react";
import { Inbox } from "lucide-react";

export default function EmptyState({
  icon: Icon = Inbox,
  message = "ยังไม่มีข้อมูล",
  hint,
}: {
  icon?: ElementType;
  message?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <Icon className="w-6 h-6 text-stone-300 mb-3" />
      <p className="text-xs text-stone-400">{message}</p>
      {hint && <p className="text-[11px] text-stone-400 mt-1">{hint}</p>}
    </div>
  );
}
