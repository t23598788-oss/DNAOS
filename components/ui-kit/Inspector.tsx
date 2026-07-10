"use client";

// UIKit — Inspector
// แผงคุณสมบัติแบบ key/value (คล้าย Inspector ใน Figma) — ใช้แสดงรายละเอียดของสิ่งที่กำลังเลือกอยู่
// รับเฉพาะ props.fields — ไม่มีชุดฟิลด์ธุรกิจตายตัวในไฟล์นี้

import Window from "./Window";
import EmptyState from "./EmptyState";
import { SlidersHorizontal } from "lucide-react";

export interface InspectorField {
  label: string;
  value: string | number | null | undefined;
  tone?: "default" | "success" | "warning" | "danger";
}

const toneClass: Record<string, string> = {
  default: "text-stone-700",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-rose-600",
};

export default function Inspector({
  title,
  fields,
  onClose,
}: {
  title: string;
  fields: InspectorField[];
  onClose: () => void;
}) {
  return (
    <Window title={title} icon={<SlidersHorizontal className="w-4 h-4 text-stone-400" />} onClose={onClose}>
      {fields.length === 0 ? (
        <EmptyState message="ยังไม่มีรายการให้ตรวจสอบ" />
      ) : (
        <dl className="divide-y divide-stone-100">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 gap-4">
              <dt className="text-[11px] text-stone-400 flex-shrink-0">{f.label}</dt>
              <dd className={"text-xs font-medium text-right truncate " + toneClass[f.tone ?? "default"]}>
                {f.value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Window>
  );
}
