"use client";

// UIKit — PartnerCard
// การ์ดสรุปคู่ค้าแบบกะทัดรัด (ใช้ต่อกับ engines/partner/timeline.ts, app/api/admin/partners/*)
// รับข้อมูลผ่าน props ทั้งหมด ไม่มีชื่อบริษัท/ยอดหนี้ตัวอย่างฝังในไฟล์นี้

import { Building2, Phone } from "lucide-react";

export interface PartnerCardProps {
  name: string;
  taxId?: string;
  phone?: string;
  debtStatus?: "current" | "due_soon" | "overdue" | "clear";
  outstandingLabel?: string; // ข้อความสรุปยอดค้าง — จัด format มาจากชั้น presenter แล้ว ไม่คำนวณในนี้
  onOpenTimeline?: () => void;
}

const statusStyle: Record<string, { label: string; className: string }> = {
  current: { label: "ปกติ", className: "text-emerald-700 border-emerald-200 bg-emerald-50" },
  due_soon: { label: "ใกล้ครบกำหนด", className: "text-amber-700 border-amber-200 bg-amber-50" },
  overdue: { label: "เกินกำหนด", className: "text-rose-700 border-rose-200 bg-rose-50" },
  clear: { label: "ไม่มีภาระค้าง", className: "text-stone-500 border-stone-200 bg-stone-50" },
};

export default function PartnerCard({
  name,
  taxId,
  phone,
  debtStatus,
  outstandingLabel,
  onOpenTimeline,
}: PartnerCardProps) {
  const style = debtStatus ? statusStyle[debtStatus] : null;

  return (
    <div
      onClick={onOpenTimeline}
      className={
        "bg-white border border-stone-200 rounded-xl p-4 " +
        (onOpenTimeline ? "cursor-pointer hover:border-stone-300 hover:shadow-sm transition" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-stone-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-stone-800 truncate">{name}</p>
            {taxId && <p className="text-[10px] text-stone-400 truncate">เลขผู้เสียภาษี {taxId}</p>}
          </div>
        </div>
        {style && (
          <span className={"text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 " + style.className}>
            {style.label}
          </span>
        )}
      </div>

      {(phone || outstandingLabel) && (
        <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-[11px]">
          {phone && (
            <span className="flex items-center gap-1 text-stone-400">
              <Phone className="w-3 h-3" /> {phone}
            </span>
          )}
          {outstandingLabel && <span className="text-stone-700 font-medium">{outstandingLabel}</span>}
        </div>
      )}
    </div>
  );
}
