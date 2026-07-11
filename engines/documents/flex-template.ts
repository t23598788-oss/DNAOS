// Owner request 2026-07-11: "ดึงข้อมูลจริงจาก Supabase ใส่ใน Template Flex
// ของ LINE เอง แล้วส่งกลับหาลูกค้าเลย" (จาก LINE Flex Message Simulator ที่
// เฮียเปิดดู) — ต้นแบบโครงสร้างมาจาก
// supabase/functions/line-webhook-v2/templates/flex/boq-card.ts (มีอยู่แล้ว
// แต่ไม่เคยถูกเรียกใช้จริง) ทำเป็น generic ให้ใช้ได้กับเอกสารทุกประเภท
// (ใบเสนอราคา/ใบแจ้งหนี้/ใบส่งของ/ใบเสร็จ) แทนที่จะเขียนแยกทีละแบบ

import { DOC_LABELS, type DocType, type DocItem } from "./engine";

const HEADER_COLOR: Partial<Record<DocType, string>> = {
  quotation: "#1565C0",
  invoice: "#C62828",
  receipt: "#2E7D32",
  delivery_order: "#EF6C00",
  delivery: "#EF6C00",
  billing: "#6A1B9A",
  boq: "#1565C0",
};

export interface DocumentFlexProps {
  documentType: DocType;
  documentNumber: string;
  partyName: string;
  items: DocItem[];
  summary: { subtotal: number; vat: number; total: number };
}

export function documentFlex({ documentType, documentNumber, partyName, items, summary }: DocumentFlexProps): object {
  const label = DOC_LABELS[documentType] ?? DOC_LABELS.quotation;
  const color = HEADER_COLOR[documentType] ?? "#37474F";

  const itemRows = items.slice(0, 10).flatMap((item) => [
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: item.description, size: "sm", color: "#333333", flex: 4, wrap: true },
      ],
    },
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: `${item.qty} ${item.unit} × ${item.unitPrice.toLocaleString("th-TH")} ฿`, size: "xs", color: "#888888", flex: 3 },
        {
          type: "text",
          text: (item.qty * item.unitPrice - (item.discount ?? 0)).toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿",
          size: "xs",
          color: "#333333",
          align: "end",
          flex: 2,
        },
      ],
    },
  ]);

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: color,
      paddingAll: "16px",
      contents: [
        { type: "text", text: label.th, color: "#FFFFFF", weight: "bold", size: "md" },
        { type: "text", text: `#${documentNumber}`, color: "#FFFFFF", size: "xs" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: partyName, weight: "bold", size: "sm", wrap: true },
        { type: "separator", margin: "sm" },
        ...itemRows,
        { type: "separator", margin: "sm" },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "ยอดก่อนภาษี", size: "xs", color: "#888888", flex: 3 },
            { type: "text", text: summary.subtotal.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", size: "xs", align: "end", flex: 2 },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "ภาษีมูลค่าเพิ่ม", size: "xs", color: "#888888", flex: 3 },
            { type: "text", text: summary.vat.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", size: "xs", align: "end", flex: 2 },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          margin: "sm",
          contents: [
            { type: "text", text: "รวมทั้งสิ้น", weight: "bold", flex: 3 },
            { type: "text", text: summary.total.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", weight: "bold", color, align: "end", flex: 2 },
          ],
        },
      ],
    },
  };
}
