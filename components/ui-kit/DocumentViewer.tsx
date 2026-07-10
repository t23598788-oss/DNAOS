"use client";

// UIKit — DocumentViewer
// แผงดูเอกสาร (quotation/boq/invoice/receipt/purchase_order/delivery_order/billing — ตาม BUSINESS-CONSTITUTION.md)
// รับ document_type + html/text content ผ่าน props — เอกสารทุกประเภทใช้ template เดียวกันตามกฎเหล็กของระบบ
// component นี้แค่ "แสดงผล" ไม่ตัดสินใจ workflow/สถานะเอกสารเอง

import Window from "./Window";
import EmptyState from "./EmptyState";
import { FileText } from "lucide-react";

export interface DocumentViewerProps {
  documentType: string; // quotation | boq | invoice | receipt | purchase_order | delivery_order | billing
  documentNumber?: string;
  status?: string;
  htmlContent?: string;
  onClose: () => void;
}

const typeLabel: Record<string, string> = {
  quotation: "ใบเสนอราคา",
  boq: "ใบประมาณปริมาณงาน",
  invoice: "ใบแจ้งหนี้",
  receipt: "ใบเสร็จรับเงิน",
  purchase_order: "ใบสั่งซื้อ",
  delivery_order: "ใบส่งสินค้า",
  billing: "ใบวางบิล",
};

export default function DocumentViewer({
  documentType,
  documentNumber,
  status,
  htmlContent,
  onClose,
}: DocumentViewerProps) {
  return (
    <Window
      title={typeLabel[documentType] ?? documentType}
      subtitle={documentNumber}
      icon={<FileText className="w-4 h-4 text-stone-400" />}
      onClose={onClose}
      width={480}
    >
      {status && (
        <div className="px-4 pt-3">
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-stone-200 text-stone-500">
            {status}
          </span>
        </div>
      )}
      {!htmlContent ? (
        <EmptyState message="ยังไม่มีเนื้อหาเอกสาร" hint="รอโหลดจาก engines/documents/engine.ts" />
      ) : (
        <div
          className="p-4 text-xs text-stone-700 leading-relaxed [&_table]:w-full [&_td]:py-1"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      )}
    </Window>
  );
}
