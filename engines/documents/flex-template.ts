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

// Real company header + terms/notes shown on every card — sourced from
// core/config/company-settings.ts (real app_configs, not hardcoded), owner
// request 2026-07-11: "หัวข้อระบบ ชื่อบริษัทเรา กติกาข้อตกลง หมายเหตุ...
// สร้างเป็นการ์ดส่งให้ลูกค้าด้วย". All optional — a field left blank in
// settings just doesn't render that line, never fabricated.
export interface CardBranding {
  ourCompanyName?: string;
  ourCompanyTaxId?: string;
  terms?: string;
  footerNote?: string;
}

function brandingFooter(branding?: CardBranding): { type: "box"; layout: "vertical"; contents: unknown[] } | null {
  if (!branding) return null;
  const lines: unknown[] = [];

  if (branding.ourCompanyName) {
    lines.push({ type: "separator", margin: "md" });
    lines.push({
      type: "text",
      text: branding.ourCompanyTaxId ? `${branding.ourCompanyName} • เลขผู้เสียภาษี ${branding.ourCompanyTaxId}` : branding.ourCompanyName,
      size: "xxs",
      color: "#999999",
      wrap: true,
      margin: "md",
    });
  }
  if (branding.terms) {
    lines.push({ type: "text", text: branding.terms, size: "xxs", color: "#999999", wrap: true, margin: "sm" });
  }
  if (branding.footerNote) {
    lines.push({ type: "text", text: branding.footerNote, size: "xxs", color: "#999999", wrap: true, margin: "sm" });
  }

  if (lines.length === 0) return null;
  return { type: "box", layout: "vertical", contents: lines };
}

export interface DocumentFlexProps {
  documentType: DocType;
  documentNumber: string;
  partyName: string;
  // Optional — existing invoices/standalone_documents in the real DB don't
  // store line items (standalone_document_items was dropped in the
  // 2026-07-10 cleanup), so sending an already-saved document only has
  // totals to show. New documents created through the chat flow still pass
  // real items for a fuller card.
  items?: DocItem[];
  summary: { subtotal: number; vat: number; total: number };
  branding?: CardBranding;
}

export function documentFlex({ documentType, documentNumber, partyName, items, summary, branding }: DocumentFlexProps): object {
  const label = DOC_LABELS[documentType] ?? DOC_LABELS.quotation;
  const color = HEADER_COLOR[documentType] ?? "#37474F";

  const itemRows = (items ?? []).slice(0, 10).flatMap((item) => [
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

  const footerBox = brandingFooter(branding);

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
        ...(footerBox ? [footerBox] : []),
      ],
    },
  };
}

export interface DebtReminderFlexProps {
  companyName: string;
  totalOutstanding: number;
  daysOverdue: number;
  branding?: CardBranding;
}

export function debtReminderFlex({ companyName, totalOutstanding, daysOverdue, branding }: DebtReminderFlexProps): object {
  const severe = daysOverdue > 30;
  const color = severe ? "#C62828" : "#EF6C00";
  const footerBox = brandingFooter(branding);

  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: color,
      paddingAll: "16px",
      contents: [
        { type: "text", text: "แจ้งยอดค้างชำระ", color: "#FFFFFF", weight: "bold", size: "md" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: companyName, weight: "bold", size: "sm", wrap: true },
        { type: "separator", margin: "sm" },
        {
          type: "box",
          layout: "horizontal",
          margin: "sm",
          contents: [
            { type: "text", text: "ยอดค้างชำระ", flex: 3 },
            { type: "text", text: totalOutstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", weight: "bold", color, align: "end", flex: 2 },
          ],
        },
        { type: "text", text: `ผิดนัดชำระ ${daysOverdue} วัน`, size: "xs", color: "#888888" },
        ...(footerBox ? [footerBox] : []),
      ],
    },
  };
}
