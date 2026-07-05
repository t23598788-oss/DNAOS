/**
 * Partner Timeline Engine
 *
 * รวม documents + business_events ของ partner คนเดียวให้เป็น timeline เรียงตามวันที่
 * Pure function — รับข้อมูลดิบจาก DB มาแปลง ไม่เรียก DB เอง
 */

import type { PartnerTimelineEntry, PartnerSummary } from "@/lib/shared/types";
import { canonicalDocumentType } from "@/lib/supabase/queries";

// ── labels สำหรับแสดงผล ──

const DOCUMENT_TYPE_LABEL: Record<string, { th: string; prefix: string }> = {
  quotation:      { th: "ใบเสนอราคา",     prefix: "QT" },
  invoice:        { th: "ใบแจ้งหนี้",     prefix: "IV" },
  receipt:        { th: "ใบเสร็จรับเงิน", prefix: "RE" },
  delivery_order: { th: "ใบส่งของ",        prefix: "DO" },
  purchase_order: { th: "ใบสั่งซื้อ",      prefix: "PO" },
  payment_voucher:{ th: "ใบสำคัญจ่าย",    prefix: "PV" },
  debt_notice:    { th: "ใบทวงหนี้",       prefix: "DN" },
};

const BUSINESS_EVENT_LABEL: Record<string, string> = {
  quotation_sent:     "ส่งใบเสนอราคา",
  po_received:        "รับใบสั่งซื้อ",
  delivery_made:      "จัดส่งสินค้า",
  invoice_issued:     "ออกใบแจ้งหน���้",
  payment_received:   "รับชำระเงิน",
  credit_note_issued: "ออกใบลดหนี้",
  line_chat:          "ข้อความ LINE",
  note:               "บันทึก",
};

const STATUS_LABEL: Record<string, string> = {
  draft:     "ร่าง",
  saved:     "บันทึกแล้ว",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิก",
  paid:      "ชำระแล้ว",
};

// ── types รับข้อมูลดิบจาก DB ──

interface RawDocument {
  id: string;
  document_type: string;
  document_number: string;
  status: string;
  net_amount: number | null;
  issue_date: string | null;
  created_at: string;
}

interface RawBusinessEvent {
  id: string;
  event_type: string;
  event_date: string;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── engine ──

export function buildPartnerTimeline(
  docs: RawDocument[],
  events: RawBusinessEvent[]
): PartnerTimelineEntry[] {
  const entries: PartnerTimelineEntry[] = [];

  for (const doc of docs) {
    const canonical = canonicalDocumentType(doc.document_type);
    const meta = DOCUMENT_TYPE_LABEL[canonical];
    const date = doc.issue_date ?? doc.created_at.split("T")[0];
    entries.push({
      date,
      kind: "document",
      event_type: canonical,
      title: meta ? `${meta.th} ${doc.document_number}` : doc.document_number,
      subtitle: meta?.prefix ?? null,
      amount: doc.net_amount,
      status: STATUS_LABEL[doc.status] ?? doc.status,
      document_id: doc.id,
      document_number: doc.document_number,
    });
  }

  for (const ev of events) {
    entries.push({
      date: ev.event_date,
      kind: "business_event",
      event_type: ev.event_type,
      title: ev.title ?? BUSINESS_EVENT_LABEL[ev.event_type] ?? ev.event_type,
      subtitle: ev.description ?? null,
      amount: null,
      status: null,
      business_event_id: ev.id,
    });
  }

  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function buildPartnerSummary(
  partner: { id: string; name: string; partner_type_label: string | null; phone: string | null },
  docs: RawDocument[]
): PartnerSummary {
  let total_invoiced = 0;
  let total_received = 0;
  let last_activity: string | null = null;

  for (const d of docs) {
    const canonical = canonicalDocumentType(d.document_type);
    const amount = Number(d.net_amount ?? 0);
    if (canonical === "invoice") total_invoiced += amount;
    if (canonical === "receipt") total_received += amount;
    const date = d.issue_date ?? d.created_at.split("T")[0];
    if (!last_activity || date > last_activity) last_activity = date;
  }

  return {
    id: partner.id,
    name: partner.name,
    partner_type_label: partner.partner_type_label,
    phone: partner.phone,
    total_invoiced,
    total_received,
    outstanding: total_invoiced - total_received,
    last_activity,
    document_count: docs.length,
  };
}
